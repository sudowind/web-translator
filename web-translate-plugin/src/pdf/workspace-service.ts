import { DOCUMENT_SCHEMA_VERSION, type DocumentModel, type DocumentPage } from '../document/model';
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
  sourceRepository,
  taskRepository,
  translationRepository,
  type StoredTask,
  type StoredSource,
  type StoredTranslation,
  type TranslationKey,
} from '../storage/repositories';
import { translatePage, translationBlocksForPage } from '../translation/translate-page';
import { loadPdfSource, type LoadedPdfSource } from './pdf-source';
import { arxivSourceUrlCandidates, readArxivSourceRevision, resolveArxivSource } from './arxiv-source';
import type {
  PdfAgentProgress,
  PdfMessage,
  PdfMessageValue,
  PdfSourceDescriptor,
  PdfTranslationProgress,
} from './messages';

export class PdfWorkspaceServiceError extends Error {
  override readonly name = 'PdfWorkspaceServiceError';

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
  loadSource(url: string, signal?: AbortSignal): Promise<LoadedPdfSource>;
  getDocument(hash: string): Promise<DocumentModel | undefined>;
  listDocumentsBySourceUrl?(sourceUrl: string): Promise<DocumentModel[]>;
  putDocument(model: DocumentModel): Promise<void>;
  getSource?(id: string): Promise<StoredSource | undefined>;
  putSource?(source: StoredSource): Promise<void>;
  getSourceRevision?(url: string, signal?: AbortSignal): Promise<string | undefined>;
  clearCache(hash: string): Promise<void>;
  getTranslation(key: TranslationKey): Promise<StoredTranslation | undefined>;
  listTranslations?(hash: string): Promise<StoredTranslation[]>;
  putTranslation(key: TranslationKey, blocks: unknown): Promise<void>;
  putTask(task: StoredTask): Promise<void>;
  listTasks?(status: StoredTask['status']): Promise<StoredTask[]>;
  getSettings(): Promise<WorkspaceSettings>;
  createMineru(settings: MineruSettings): MineruPort;
  loadMineru(url: string, metadata: { sourceUrl: string; hash: string; title: string; pageCount: number }): Promise<DocumentModel>;
  createOpenAi(settings: OpenAiSettings): Pick<OpenAiTranslationClient, 'translate'>;
  createAgent?: (settings: OpenAiSettings) => Pick<OpenAiPaperAgentClient, 'ask'>;
  reportTranslationProgress?(tabId: number, progress: PdfTranslationProgress): void | Promise<void>;
  reportAgentProgress?(tabId: number, progress: PdfAgentProgress): void | Promise<void>;
}

const defaults: Dependencies = {
  loadSource: (url, signal) => loadPdfSource(url, globalThis.fetch, signal),
  getDocument: (hash) => documentRepository.get(hash),
  listDocumentsBySourceUrl: (sourceUrl) => documentRepository.listBySourceUrl(sourceUrl),
  putDocument: (model) => documentRepository.put(model),
  getSource: (id) => sourceRepository.get(id),
  putSource: (source) => sourceRepository.put(source),
  getSourceRevision: (url, signal) => readArxivSourceRevision(url, globalThis.fetch, signal),
  clearCache: (hash) => clearDocumentCache(hash),
  getTranslation: (key) => translationRepository.get(key),
  listTranslations: (hash) => translationRepository.listByHash(hash),
  putTranslation: (key, blocks) => translationRepository.put(key, blocks),
  putTask: (task) => taskRepository.put(task),
  listTasks: (status) => taskRepository.listByStatus(status),
  getSettings,
  createMineru: (settings) => new MineruClient(settings),
  loadMineru: (url, metadata) => loadMineruResult(url, metadata),
  createOpenAi: (settings) => new OpenAiTranslationClient(settings),
  createAgent: (settings) => new OpenAiPaperAgentClient(settings),
  reportTranslationProgress: (tabId, progress) => {
    void browser.tabs.sendMessage(tabId, progress).catch(() => undefined);
  },
  reportAgentProgress: (tabId, progress) => {
    void browser.tabs.sendMessage(tabId, progress).catch(() => undefined);
  },
};

export class PdfWorkspaceService {
  private readonly sessions = new Map<number, AbortController>();
  private readonly agentSessions = new Map<number, AbortController>();
  private readonly resuming = new Set<string>();
  private readonly mutationTails = new Map<string, Promise<unknown>>();
  private readonly generations = new Map<string, number>();
  private readonly cacheClears = new Map<string, Promise<unknown>>();
  private readonly documents = new Map<string, DocumentModel>();

  constructor(private readonly dependencies: Dependencies = defaults) {}

  async handle(message: PdfMessage, tabId: number): Promise<PdfMessageValue> {
    if (message.type === 'pdf:cancel') {
      this.dispose(tabId);
      return { cancelled: true };
    }
    if (message.type === 'pdf:agent-cancel') {
      this.agentSessions.get(tabId)?.abort();
      this.agentSessions.delete(tabId);
      return { cancelled: true };
    }
    if (message.type === 'pdf:cache-clear') {
      this.cancel(tabId);
      await this.clearDocument(message.hash);
      return { cleared: true };
    }
    if (message.type === 'pdf:cache-clear-source') {
      this.cancel(tabId);
      await this.clearSourceDocuments(message.sourceUrl);
      return { cleared: true };
    }
    if (message.type === 'pdf:agent-ask') {
      const controller = new AbortController();
      this.agentSessions.get(tabId)?.abort();
      this.agentSessions.set(tabId, controller);
      return this.ask(message, controller.signal, tabId).finally(() => {
        if (this.agentSessions.get(tabId) === controller) this.agentSessions.delete(tabId);
      });
    }
    const signal = this.session(tabId).signal;
    if (message.type === 'pdf:document-resolve') {
      return this.resolveDocument(message.sourceUrl, signal);
    }
    if (message.type === 'pdf:document-get') {
      return (await this.getDocument(message.hash)) ?? null;
    }
    if (message.type === 'pdf:translation-snapshot') {
      return this.translationSnapshot(message.hash);
    }
    if (message.type === 'pdf:parse-start') {
      return this.parse(message.source, message.pageCount, message.consent, signal);
    }
    return this.translate(message.hash, message.page, signal, tabId);
  }

  cancel(tabId: number): void {
    this.sessions.get(tabId)?.abort();
    this.sessions.delete(tabId);
    this.agentSessions.get(tabId)?.abort();
    this.agentSessions.delete(tabId);
  }

  dispose(tabId: number): void {
    this.cancel(tabId);
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
    source: PdfSourceDescriptor,
    pageCount: number,
    consent: boolean,
    signal: AbortSignal,
  ): Promise<DocumentModel> {
    const generation = this.generation(source.hash);
    const cached = await this.getDocument(source.hash);
    if (cached?.schemaVersion === DOCUMENT_SCHEMA_VERSION) {
      if (!await this.bindSource(source, cached.hash, generation)) throw cacheInvalidatedError();
      return cached;
    }
    if (source.kind === 'authenticated' && !consent) {
      throw new PdfWorkspaceServiceError('PDF_AUTH_UPLOAD_REQUIRES_CONSENT');
    }
    const settings = await this.dependencies.getSettings();
    if (!settings.mineru.token) throw new PdfWorkspaceServiceError('MINERU_NOT_CONFIGURED');
    const client = this.dependencies.createMineru(settings.mineru);
    let providerTask: MineruTaskRef;
    let usedUpload = source.kind === 'authenticated';
    if (source.kind === 'authenticated') {
      providerTask = await this.createUpload(client, source, consent, signal);
    } else {
      try {
        providerTask = await client.createUrlTask(source.url, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        usedUpload = true;
        providerTask = await this.createUpload(client, source, consent, signal);
      }
    }
    let task = await this.createTask(source, pageCount, providerTask, generation);
    let result;
    try {
      result = await client.waitForResult(task.providerTask, signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (usedUpload) {
        await this.failTask(task, 'MINERU_UPLOAD_FAILED', generation);
        throw new PdfWorkspaceServiceError('MINERU_UPLOAD_FAILED');
      }
      result = { state: 'failed' as const, error: 'MINERU_TASK_FAILED' };
    }
    if (!usedUpload && result.state !== 'done') {
      await this.putTask(source.hash, generation, { ...task, status: 'failed', errorCode: safeTaskError(result), updatedAt: Date.now() });
      try {
        usedUpload = true;
        task = await this.createTask(
          source,
          pageCount,
          await this.createUpload(client, source, consent, signal),
          generation,
        );
        result = await client.waitForResult(task.providerTask, signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const errorCode = error instanceof PdfWorkspaceServiceError && error.code === 'PDF_SOURCE_CHANGED'
          ? error.code
          : 'MINERU_UPLOAD_FAILED';
        await this.failTask(task, errorCode, generation);
        if (errorCode === 'PDF_SOURCE_CHANGED') throw error;
        throw new PdfWorkspaceServiceError(errorCode);
      }
    }
    if (result.state !== 'done') {
      const errorCode = safeTaskError(result);
      await this.putTask(source.hash, generation, { ...task, status: 'failed', errorCode, updatedAt: Date.now() });
      throw new PdfWorkspaceServiceError(errorCode);
    }
    signal.throwIfAborted();
    const model = await this.dependencies.loadMineru(result.fullZipUrl, {
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount,
    });
    signal.throwIfAborted();
    const documentStored = await this.enqueueMutation(source.hash, generation, async () => {
      await this.dependencies.putDocument(model);
      return true;
    });
    if (documentStored !== true) throw cacheInvalidatedError();
    if (!await this.bindSource(source, model.hash, generation)) throw cacheInvalidatedError();
    if (generation !== this.generation(source.hash)) throw cacheInvalidatedError();
    this.rememberDocument(model);
    await this.putTask(source.hash, generation, { ...task, status: 'done', errorCode: undefined, updatedAt: Date.now() });
    return model;
  }

  private async failTask(task: StoredTask, errorCode: string, generation: number): Promise<void> {
    await this.putTask(task.hash, generation, { ...task, status: 'failed', errorCode, updatedAt: Date.now() });
  }

  private async createTask(
    source: PdfSourceDescriptor,
    pageCount: number,
    providerTask: MineruTaskRef,
    generation: number,
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
    await this.putTask(source.hash, generation, task);
    return task;
  }

  private async createUpload(
    client: MineruPort,
    descriptor: PdfSourceDescriptor,
    consent: boolean,
    signal: AbortSignal,
  ): Promise<MineruTaskRef> {
    if (!client.createUploadTask) throw new PdfWorkspaceServiceError('MINERU_UPLOAD_UNAVAILABLE');
    const source = await this.sourceForUpload(descriptor, signal);
    if (source.descriptor.kind === 'authenticated' && !consent) {
      throw new PdfWorkspaceServiceError('PDF_AUTH_UPLOAD_REQUIRES_CONSENT');
    }
    return client.createUploadTask(
      source.descriptor.title,
      source.bytes.buffer,
      signal,
    );
  }

  private async sourceForUpload(
    descriptor: PdfSourceDescriptor,
    signal: AbortSignal,
  ): Promise<LoadedPdfSource> {
    const loaded = await this.dependencies.loadSource(descriptor.url, signal);
    signal.throwIfAborted();
    if (loaded.descriptor.hash !== descriptor.hash) {
      throw new PdfWorkspaceServiceError('PDF_SOURCE_CHANGED');
    }
    return loaded;
  }

  private async resumeTask(task: StoredTask): Promise<void> {
    if (this.resuming.has(task.id)) return;
    this.resuming.add(task.id);
    const generation = this.generation(task.hash);
    try {
      const settings = await this.dependencies.getSettings();
      const result = await this.dependencies.createMineru(settings.mineru)
        .waitForResult(task.providerTask);
      if (result.state !== 'done') {
        await this.putTask(task.hash, generation, { ...task, status: 'failed', errorCode: safeTaskError(result), updatedAt: Date.now() });
        return;
      }
      const model = await this.dependencies.loadMineru(result.fullZipUrl, {
        sourceUrl: task.sourceUrl,
        hash: task.hash,
        title: task.title,
        pageCount: task.pageCount,
      });
      const documentStored = await this.enqueueMutation(task.hash, generation, async () => {
        await this.dependencies.putDocument(model);
        return true;
      });
      if (documentStored === true && await this.bindSource({
        url: task.sourceUrl,
        hash: task.hash,
        title: task.title,
        size: 0,
        kind: 'remote',
      }, model.hash, generation) && generation === this.generation(task.hash)) {
        this.rememberDocument(model);
      }
      await this.putTask(task.hash, generation, { ...task, status: 'done', errorCode: undefined, updatedAt: Date.now() });
    } catch {
      await this.putTask(task.hash, generation, { ...task, status: 'failed', errorCode: 'MINERU_RESUME_FAILED', updatedAt: Date.now() });
    } finally {
      this.resuming.delete(task.id);
    }
  }

  private async translate(
    hash: string,
    pageNumber: number,
    signal: AbortSignal,
    tabId: number,
  ): Promise<TranslationResult[]> {
    const generation = this.generation(hash);
    const model = await this.getDocument(hash);
    const page = model?.pages[pageNumber - 1];
    if (!model || !page) throw new PdfWorkspaceServiceError('PDF_PAGE_MISSING');
    const settings = await this.dependencies.getSettings();
    const key: TranslationKey = {
      hash,
      page: pageNumber,
      source: settings.sourceLanguage,
      target: settings.targetLanguage,
      provider: 'openai',
      model: settings.openAi.defaultModel,
      schema: translationCacheSchemaForPage(page),
    };
    const expectedIds = translationBlocksForPage(page).map((block) => block.id);
    const cached = await this.dependencies.getTranslation(key);
    if (cached && isTranslationsForIds(cached.blocks, expectedIds)) return cached.blocks;
    const result = await translatePage(
      this.dependencies.createOpenAi(settings.openAi),
      page,
      { sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage },
      signal,
      undefined,
      settings.openAi.defaultModel,
      (attempt) => this.dependencies.reportTranslationProgress?.(tabId, {
        type: 'pdf:translation-progress',
        hash,
        page: pageNumber,
        attempt,
        maxAttempts: 3,
      }),
    );
    signal.throwIfAborted();
    await this.enqueueMutation(hash, generation, () => this.dependencies.putTranslation(key, result));
    return result;
  }

  private generation(hash: string): number {
    return this.generations.get(hash) ?? 0;
  }

  private invalidate(hash: string): void {
    this.generations.set(hash, this.generation(hash) + 1);
  }

  private async putTask(hash: string, generation: number, task: StoredTask): Promise<void> {
    await this.enqueueMutation(hash, generation, () => this.dependencies.putTask(task));
  }

  private enqueueMutation<T>(hash: string, generation: number, operation: () => Promise<T>): Promise<T | undefined> {
    return this.enqueue(hash, async () => {
      if (generation !== this.generation(hash)) return undefined;
      return operation();
    });
  }

  private enqueueForced<T>(hash: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueue(hash, operation) as Promise<T>;
  }

  private enqueue<T>(hash: string, operation: () => Promise<T>): Promise<T | undefined> {
    const previous = this.mutationTails.get(hash) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutationTails.set(hash, next);
    const cleanup = () => {
      if (this.mutationTails.get(hash) === next) this.mutationTails.delete(hash);
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  private async translationSnapshot(hash: string): Promise<{
    pages: Array<{ page: number; blocks: TranslationResult[] }>;
  }> {
    const model = await this.getDocument(hash);
    if (!model) return { pages: [] };
    const settings = await this.dependencies.getSettings();
    const records = await this.dependencies.listTranslations?.(hash) ?? [];
    const pages: Array<{ page: number; blocks: TranslationResult[] }> = [];
    for (const record of records) {
      const page = model.pages[record.page - 1];
      if (!page || record.hash !== hash || record.source !== settings.sourceLanguage ||
        record.target !== settings.targetLanguage || record.provider !== 'openai' ||
        record.model !== settings.openAi.defaultModel || record.schema !== translationCacheSchemaForPage(page)) {
        continue;
      }
      const expectedIds = translationBlocksForPage(page).map((block) => block.id);
      if (!isTranslationsForIds(record.blocks, expectedIds)) continue;
      pages.push({ page: record.page, blocks: record.blocks });
    }
    pages.sort((left, right) => left.page - right.page);
    return { pages };
  }

  private async getDocument(hash: string): Promise<DocumentModel | undefined> {
    const generation = this.generation(hash);
    await this.cacheClears.get(hash);
    if (generation !== this.generation(hash)) return this.getDocument(hash);
    const cached = this.documents.get(hash);
    if (cached) {
      this.documents.delete(hash);
      this.documents.set(hash, cached);
      return cached;
    }
    const model = await this.dependencies.getDocument(hash);
    if (generation !== this.generation(hash)) return this.getDocument(hash);
    if (model) this.rememberDocument(model);
    return model;
  }

  private async resolveDocument(sourceUrl: string, signal: AbortSignal): Promise<DocumentModel | null> {
    const identity = resolveArxivSource(sourceUrl);
    if (!identity) return null;
    const sourceGeneration = this.generation(identity.key);
    let stored = await this.dependencies.getSource?.(identity.key);
    let model = await this.getDocument(stored?.hash ?? identity.key);
    if (sourceGeneration !== this.generation(identity.key)) return null;
    if (!model && this.dependencies.listDocumentsBySourceUrl) {
      const legacyModels = new Map<string, DocumentModel>();
      for (const candidate of arxivSourceUrlCandidates(identity, sourceUrl)) {
        for (const candidateModel of await this.dependencies.listDocumentsBySourceUrl(candidate)) {
          legacyModels.set(candidateModel.hash, candidateModel);
        }
      }
      if (sourceGeneration !== this.generation(identity.key)) return null;
      if (legacyModels.size === 1) {
        model = legacyModels.values().next().value;
        if (model) this.rememberDocument(model);
      }
    }
    if (model && model.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
      await this.clearDocument(model.hash);
      model = undefined;
      stored = undefined;
    }

    const mutationHash = model?.hash ?? stored?.hash ?? identity.key;
    const generation = this.generation(mutationHash);
    const revision = identity.version === null
      ? await this.dependencies.getSourceRevision?.(identity.pdfUrl, signal)
      : `version:${identity.version}`;
    if (generation !== this.generation(mutationHash)) return null;
    if (model && stored?.revision && revision && stored.revision !== revision) {
      await this.clearDocument(model.hash);
      const baselineGeneration = this.generation(identity.key);
      await this.enqueueMutation(identity.key, baselineGeneration, async () => {
        await this.dependencies.putSource?.({
          id: identity.key,
          hash: identity.key,
          sourceUrl: identity.pdfUrl,
          revision,
          updatedAt: Date.now(),
        });
      });
      return null;
    }

    const sourceStored = await this.enqueueMutation(mutationHash, generation, async () => {
      await this.dependencies.putSource?.({
        id: identity.key,
        hash: mutationHash,
        sourceUrl: identity.pdfUrl,
        ...(revision ?? stored?.revision ? { revision: revision ?? stored?.revision } : {}),
        updatedAt: Date.now(),
      });
      return true;
    });
    if (sourceStored !== true || generation !== this.generation(mutationHash)) return null;
    return model ?? null;
  }

  private async bindSource(
    source: PdfSourceDescriptor,
    hash: string,
    generation = this.generation(hash),
  ): Promise<boolean> {
    const identity = resolveArxivSource(source.url);
    if (!identity || !this.dependencies.putSource) return true;
    const stored = await this.enqueueMutation(hash, generation, async () => {
      const current = await this.dependencies.getSource?.(identity.key);
      await this.dependencies.putSource!({
        id: identity.key,
        hash,
        sourceUrl: identity.pdfUrl,
        ...(current?.revision ? { revision: current.revision } : {}),
        updatedAt: Date.now(),
      });
      return true;
    });
    return stored === true;
  }

  private async clearDocument(hash: string): Promise<void> {
    this.invalidate(hash);
    this.documents.delete(hash);
    const clearing = this.enqueueForced(hash, () => this.dependencies.clearCache(hash));
    this.cacheClears.set(hash, clearing);
    try {
      await clearing;
      this.documents.delete(hash);
    } finally {
      if (this.cacheClears.get(hash) === clearing) this.cacheClears.delete(hash);
    }
  }

  private async clearSourceDocuments(sourceUrl: string): Promise<void> {
    const identity = resolveArxivSource(sourceUrl);
    if (!identity) throw new PdfWorkspaceServiceError('PDF_SOURCE_URL_INVALID');
    const stored = await this.dependencies.getSource?.(identity.key);
    const hashes = new Set([stored?.hash, identity.key].filter((hash): hash is string => Boolean(hash)));
    if (this.dependencies.listDocumentsBySourceUrl) {
      for (const candidate of arxivSourceUrlCandidates(identity, sourceUrl)) {
        for (const model of await this.dependencies.listDocumentsBySourceUrl(candidate)) {
          hashes.add(model.hash);
        }
      }
    }
    await Promise.all([...hashes].map((hash) => this.clearDocument(hash)));
  }

  private rememberDocument(model: DocumentModel): void {
    this.documents.delete(model.hash);
    this.documents.set(model.hash, model);
    while (this.documents.size > 3) {
      const oldest = this.documents.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.documents.delete(oldest);
    }
  }

  private async ask(
    message: Extract<PdfMessage, { type: 'pdf:agent-ask' }>,
    signal: AbortSignal,
    tabId: number,
  ): Promise<{ answer: string; mode: 'full' | 'compressed'; notice?: string }> {
    const model = await this.getDocument(message.hash);
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
    const answer = await client.ask(context, message.question, signal, (delta) => {
      if (signal.aborted) return;
      void this.dependencies.reportAgentProgress?.(tabId, {
        type: 'pdf:agent-progress',
        hash: message.hash,
        requestId: message.requestId,
        delta,
      });
    });
    signal.throwIfAborted();
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

function cacheInvalidatedError(): DOMException {
  return new DOMException('PDF_CACHE_INVALIDATED', 'AbortError');
}

function translationCacheSchemaForPage(page: DocumentPage): 1 | 2 {
  return page.blocks.some((block) => block.kind === 'table' || block.kind === 'figure') ? 2 : 1;
}

function isTranslationsForIds(
  value: unknown,
  expectedIds: readonly string[],
): value is TranslationResult[] {
  if (!Array.isArray(value)) return false;
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== 'object' || item === null ||
      typeof (item as TranslationResult).id !== 'string' ||
      typeof (item as TranslationResult).text !== 'string' ||
      !expected.has((item as TranslationResult).id) ||
      seen.has((item as TranslationResult).id)
    ) return false;
    seen.add((item as TranslationResult).id);
  }
  return seen.size === expected.size;
}
