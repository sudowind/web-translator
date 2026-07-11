import type { DocumentModel } from '../document/model';
import { OpenAiPaperAgentClient } from '../agent/client';
import { buildAgentContext } from '../agent/context-builder';
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
  createUploadTask?(fileName: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<MineruTaskRef>;
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
  listTasks?(status: StoredTask['status']): Promise<StoredTask[]>;
  getSettings(): Promise<WorkspaceSettings>;
  createMineru(settings: MineruSettings): MineruPort;
  loadMineru(url: string, metadata: { sourceUrl: string; hash: string; title: string; pageCount: number }): Promise<DocumentModel>;
  createOpenAi(settings: OpenAiSettings): Pick<OpenAiTranslationClient, 'translate'>;
  createAgent?: (settings: OpenAiSettings) => Pick<OpenAiPaperAgentClient, 'ask'>;
}

const defaults: Dependencies = {
  loadSource: (url, signal) => loadPdfSource(url, globalThis.fetch, signal),
  getDocument: (hash) => documentRepository.get(hash),
  putDocument: (model) => documentRepository.put(model),
  clearCache: (hash) => clearDocumentCache(hash),
  getTranslation: (key) => translationRepository.get(key),
  putTranslation: (key, blocks) => translationRepository.put(key, blocks),
  putTask: (task) => taskRepository.put(task),
  listTasks: (status) => taskRepository.listByStatus(status),
  getSettings,
  createMineru: (settings) => new MineruClient(settings),
  loadMineru: (url, metadata) => loadMineruResult(url, metadata),
  createOpenAi: (settings) => new OpenAiTranslationClient(settings),
  createAgent: (settings) => new OpenAiPaperAgentClient(settings),
};

export class PdfWorkspaceService {
  private readonly sessions = new Map<number, AbortController>();
  private readonly resuming = new Set<string>();

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
      return this.parse(message.source, message.pageCount, message.consent, signal);
    }
    if (message.type === 'pdf:agent-ask') {
      return this.ask(message, signal);
    }
    return this.translate(message.hash, message.page, signal);
  }

  cancel(tabId: number): void {
    this.sessions.get(tabId)?.abort();
    this.sessions.delete(tabId);
  }

  async resumePending(): Promise<void> {
    const tasks = await this.dependencies.listTasks?.('parsing') ?? [];
    await Promise.all(tasks.map((task) => this.resumeTask(task)));
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
    consent: boolean,
    signal: AbortSignal,
  ): Promise<DocumentModel> {
    const cached = await this.dependencies.getDocument(source.hash);
    if (cached) return cached;
    if (source.kind === 'authenticated' && !consent) {
      throw new PdfWorkspaceServiceError('PDF_AUTH_UPLOAD_REQUIRES_CONSENT');
    }
    const settings = await this.dependencies.getSettings();
    if (!settings.mineru.token) throw new PdfWorkspaceServiceError('MINERU_NOT_CONFIGURED');
    const client = this.dependencies.createMineru(settings.mineru);
    let providerTask: MineruTaskRef;
    if (source.kind === 'authenticated') {
      providerTask = await this.createUpload(client, source, signal);
    } else {
      try {
        providerTask = await client.createUrlTask(source.url, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        providerTask = await this.createUpload(client, source, signal);
      }
    }
    let task = await this.createTask(source, pageCount, providerTask);
    let result = await client.waitForResult(task.providerTask, signal);
    if (source.kind === 'remote' && result.state !== 'done') {
      await this.dependencies.putTask({ ...task, status: 'failed', errorCode: safeTaskError(result), updatedAt: Date.now() });
      task = await this.createTask(source, pageCount, await this.createUpload(client, source, signal));
      result = await client.waitForResult(task.providerTask, signal);
    }
    if (result.state !== 'done') {
      const errorCode = safeTaskError(result);
      await this.dependencies.putTask({ ...task, status: 'failed', errorCode, updatedAt: Date.now() });
      throw new PdfWorkspaceServiceError(errorCode);
    }
    const model = await this.dependencies.loadMineru(result.fullZipUrl, {
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount,
    });
    await this.dependencies.putDocument(model);
    await this.dependencies.putTask({ ...task, status: 'done', errorCode: undefined, updatedAt: Date.now() });
    return model;
  }

  private async createTask(
    source: PdfSourceTransfer,
    pageCount: number,
    providerTask: MineruTaskRef,
  ): Promise<StoredTask> {
    const task: StoredTask = {
      id: `pdf:${source.hash}`,
      type: 'mineru',
      providerTask,
      status: 'parsing',
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount,
      updatedAt: Date.now(),
    };
    await this.dependencies.putTask(task);
    return task;
  }

  private async createUpload(
    client: MineruPort,
    source: PdfSourceTransfer,
    signal: AbortSignal,
  ): Promise<MineruTaskRef> {
    if (!client.createUploadTask) throw new PdfWorkspaceServiceError('MINERU_UPLOAD_UNAVAILABLE');
    return client.createUploadTask(
      source.title,
      Uint8Array.from(source.bytes).buffer,
      signal,
    );
  }

  private async resumeTask(task: StoredTask): Promise<void> {
    if (this.resuming.has(task.id)) return;
    this.resuming.add(task.id);
    try {
      const settings = await this.dependencies.getSettings();
      const result = await this.dependencies.createMineru(settings.mineru)
        .waitForResult(task.providerTask);
      if (result.state !== 'done') {
        await this.dependencies.putTask({ ...task, status: 'failed', errorCode: safeTaskError(result), updatedAt: Date.now() });
        return;
      }
      const model = await this.dependencies.loadMineru(result.fullZipUrl, {
        sourceUrl: task.sourceUrl,
        hash: task.hash,
        title: task.title,
        pageCount: task.pageCount,
      });
      await this.dependencies.putDocument(model);
      await this.dependencies.putTask({ ...task, status: 'done', errorCode: undefined, updatedAt: Date.now() });
    } catch {
      await this.dependencies.putTask({ ...task, status: 'failed', errorCode: 'MINERU_RESUME_FAILED', updatedAt: Date.now() });
    } finally {
      this.resuming.delete(task.id);
    }
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

  private async ask(
    message: Extract<PdfMessage, { type: 'pdf:agent-ask' }>,
    signal: AbortSignal,
  ): Promise<{ answer: string; mode: 'full' | 'compressed'; notice?: string }> {
    const model = await this.dependencies.getDocument(message.hash);
    if (!model) throw new PdfWorkspaceServiceError('PDF_DOCUMENT_MISSING');
    const context = buildAgentContext({
      model,
      activePage: message.activePage,
      selection: message.selection,
      recentMessages: message.recentMessages,
      maxCharacters: message.maxCharacters,
    });
    const settings = await this.dependencies.getSettings();
    const client = this.dependencies.createAgent?.(settings.openAi);
    if (!client) throw new PdfWorkspaceServiceError('AGENT_UNAVAILABLE');
    const answer = await client.ask(context, message.question, signal);
    return {
      answer,
      mode: context.mode,
      ...(context.notice ? { notice: context.notice } : {}),
    };
  }
}

function safeTaskError(result: { state: string; error?: string }): string {
  return result.state === 'failed' && typeof result.error === 'string' && /^MINERU_[A-Z0-9_]+$/.test(result.error)
    ? result.error
    : 'MINERU_RESULT_MISSING';
}

function isTranslations(value: unknown): value is TranslationResult[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'object' && item !== null &&
    typeof (item as TranslationResult).id === 'string' &&
    typeof (item as TranslationResult).text === 'string');
}
