import type { DocumentModel } from '../document/model';
import { MineruClient } from '../providers/mineru/client';
import type { MineruSettings, MineruTaskRef } from '../providers/mineru/contracts';
import { loadMineruResult } from '../providers/mineru/result-loader';
import { OpenAiTranslationClient } from '../providers/openai/client';
import type { OpenAiSettings, TranslationResult } from '../providers/openai/contracts';
import { getSettings } from '../settings/store';
import {
  clearDocumentCache,
  documentRepository,
  taskRepository,
  translationRepository,
  type StoredTask,
  type StoredTranslation,
  type TranslationKey,
} from '../storage/repositories';
import { translatePage } from '../translation/translate-page';
import { loadPdfSource } from './pdf-source';
import type { PdfMessage, PdfMessageValue, PdfSourceTransfer } from './messages';

export class PdfWorkspaceServiceError extends Error {
  readonly name = 'PdfWorkspaceServiceError';

  constructor(readonly code: string) {
    super(code);
  }
}

interface WorkspaceSettings {
  openAi: OpenAiSettings;
  mineru: MineruSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

interface MineruPort {
  createUrlTask(url: string, signal?: AbortSignal): Promise<MineruTaskRef>;
  waitForResult(task: MineruTaskRef, signal?: AbortSignal): Promise<
    | { state: 'pending' | 'running' }
    | { state: 'done'; fullZipUrl: string }
    | { state: 'failed'; error: string }
  >;
}

interface Dependencies {
  loadSource(url: string, signal?: AbortSignal): Promise<PdfSourceTransfer>;
  getDocument(hash: string): Promise<DocumentModel | undefined>;
  putDocument(model: DocumentModel): Promise<void>;
  clearCache(hash: string): Promise<void>;
  getTranslation(key: TranslationKey): Promise<StoredTranslation | undefined>;
  putTranslation(key: TranslationKey, blocks: unknown): Promise<void>;
  putTask(task: StoredTask): Promise<void>;
  getSettings(): Promise<WorkspaceSettings>;
  createMineru(settings: MineruSettings): MineruPort;
  loadMineru(url: string, metadata: { sourceUrl: string; hash: string; title: string; pageCount: number }): Promise<DocumentModel>;
  createOpenAi(settings: OpenAiSettings): Pick<OpenAiTranslationClient, 'translate'>;
}

const defaults: Dependencies = {
  loadSource: (url, signal) => loadPdfSource(url, globalThis.fetch, signal),
  getDocument: (hash) => documentRepository.get(hash),
  putDocument: (model) => documentRepository.put(model),
  clearCache: (hash) => clearDocumentCache(hash),
  getTranslation: (key) => translationRepository.get(key),
  putTranslation: (key, blocks) => translationRepository.put(key, blocks),
  putTask: (task) => taskRepository.put(task),
  getSettings,
  createMineru: (settings) => new MineruClient(settings),
  loadMineru: (url, metadata) => loadMineruResult(url, metadata),
  createOpenAi: (settings) => new OpenAiTranslationClient(settings),
};

export class PdfWorkspaceService {
  private readonly sessions = new Map<number, AbortController>();

  constructor(private readonly dependencies: Dependencies = defaults) {}

  async handle(message: PdfMessage, tabId: number): Promise<PdfMessageValue> {
    if (message.type === 'pdf:cancel') {
      this.sessions.get(tabId)?.abort();
      this.sessions.delete(tabId);
      return { cancelled: true };
    }
    const signal = this.session(tabId).signal;
    if (message.type === 'pdf:source') {
      return this.dependencies.loadSource(message.url, signal);
    }
    if (message.type === 'pdf:document-get') {
      return (await this.dependencies.getDocument(message.hash)) ?? null;
    }
    if (message.type === 'pdf:cache-clear') {
      await this.dependencies.clearCache(message.hash);
      return { cleared: true };
    }
    if (message.type === 'pdf:parse-start') {
      return this.parse(message.source, message.pageCount, signal);
    }
    return this.translate(message.hash, message.page, signal);
  }

  cancel(tabId: number): void {
    this.sessions.get(tabId)?.abort();
    this.sessions.delete(tabId);
  }

  private session(tabId: number): AbortController {
    const current = this.sessions.get(tabId);
    if (current && !current.signal.aborted) return current;
    const controller = new AbortController();
    this.sessions.set(tabId, controller);
    return controller;
  }

  private async parse(
    source: PdfSourceTransfer,
    pageCount: number,
    signal: AbortSignal,
  ): Promise<DocumentModel> {
    const cached = await this.dependencies.getDocument(source.hash);
    if (cached) return cached;
    if (source.kind === 'authenticated') {
      throw new PdfWorkspaceServiceError('PDF_AUTH_UPLOAD_REQUIRES_CONSENT');
    }
    const settings = await this.dependencies.getSettings();
    if (!settings.mineru.token) throw new PdfWorkspaceServiceError('MINERU_NOT_CONFIGURED');
    const client = this.dependencies.createMineru(settings.mineru);
    const providerTask = await client.createUrlTask(source.url, signal);
    const task: StoredTask = {
      id: `pdf:${source.hash}`,
      type: 'mineru',
      providerTask,
      status: 'parsing',
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount,
    };
    await this.dependencies.putTask(task);
    const result = await client.waitForResult(providerTask, signal);
    if (result.state !== 'done') {
      await this.dependencies.putTask({ ...task, status: 'failed' });
      throw new PdfWorkspaceServiceError(
        result.state === 'failed' ? result.error : 'MINERU_RESULT_MISSING',
      );
    }
    const model = await this.dependencies.loadMineru(result.fullZipUrl, {
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount,
    });
    await this.dependencies.putDocument(model);
    await this.dependencies.putTask({ ...task, status: 'done' });
    return model;
  }

  private async translate(
    hash: string,
    pageNumber: number,
    signal: AbortSignal,
  ): Promise<TranslationResult[]> {
    const model = await this.dependencies.getDocument(hash);
    const page = model?.pages[pageNumber - 1];
    if (!model || !page) throw new PdfWorkspaceServiceError('PDF_PAGE_MISSING');
    const settings = await this.dependencies.getSettings();
    const key: TranslationKey = {
      hash,
      page: pageNumber,
      source: settings.sourceLanguage,
      target: settings.targetLanguage,
      provider: 'openai',
      model: settings.openAi.model,
      schema: 1,
    };
    const cached = await this.dependencies.getTranslation(key);
    if (cached && isTranslations(cached.blocks)) return cached.blocks;
    const result = await translatePage(
      this.dependencies.createOpenAi(settings.openAi),
      page,
      { sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage },
      signal,
    );
    await this.dependencies.putTranslation(key, result);
    return result;
  }
}

function isTranslations(value: unknown): value is TranslationResult[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'object' && item !== null &&
    typeof (item as TranslationResult).id === 'string' &&
    typeof (item as TranslationResult).text === 'string');
}
