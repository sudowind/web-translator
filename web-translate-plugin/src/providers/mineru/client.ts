import {
  MineruError,
  type MineruSettings,
  type MineruTaskRef,
  type MineruTaskResult,
} from './contracts';

interface MineruClientOptions {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  createId?: () => string;
  maxPollAttempts?: number;
  initialPollDelayMs?: number;
  maxPollDelayMs?: number;
}

const waitingStates = new Set(['pending', 'waiting-file']);
const runningStates = new Set(['running', 'uploading', 'converting']);

export class MineruClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly createId: () => string;
  private readonly maxPollAttempts: number;
  private readonly initialPollDelayMs: number;
  private readonly maxPollDelayMs: number;

  constructor(
    private readonly settings: MineruSettings,
    options: MineruClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.maxPollAttempts = options.maxPollAttempts ?? 120;
    this.initialPollDelayMs = options.initialPollDelayMs ?? 1_000;
    this.maxPollDelayMs = options.maxPollDelayMs ?? 30_000;
  }

  async createUrlTask(url: string, signal?: AbortSignal): Promise<MineruTaskRef> {
    const body = await this.requestJson('/api/v4/extract/task', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ url, model_version: this.settings.modelVersion }),
      signal,
    }, 'MINERU_CREATE_HTTP');
    const data = responseData(body, 'MINERU_CREATE_INVALID');
    if (typeof data.task_id !== 'string' || !data.task_id) {
      throw new MineruError('MINERU_CREATE_INVALID');
    }
    return { kind: 'single', id: data.task_id };
  }

  async createUploadTask(
    fileName: string,
    bytes: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<MineruTaskRef> {
    const dataId = this.createId();
    const body = await this.requestJson('/api/v4/file-urls/batch', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        files: [{ name: fileName, data_id: dataId }],
        model_version: this.settings.modelVersion,
      }),
      signal,
    }, 'MINERU_UPLOAD_INIT_HTTP');
    const data = responseData(body, 'MINERU_UPLOAD_INIT_INVALID');
    const uploadUrl = Array.isArray(data.file_urls) ? data.file_urls[0] : undefined;
    if (typeof data.batch_id !== 'string' || !data.batch_id || typeof uploadUrl !== 'string' || !uploadUrl) {
      throw new MineruError('MINERU_UPLOAD_INIT_INVALID');
    }

    const fetcher = this.fetcher;
    let uploaded: Response;
    try {
      uploaded = await fetcher(uploadUrl, { method: 'PUT', body: bytes, signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new MineruError('MINERU_UPLOAD_NETWORK');
    }
    if (!uploaded.ok) throw new MineruError('MINERU_UPLOAD_HTTP', uploaded.status);
    return { kind: 'batch', id: data.batch_id, dataId };
  }

  async waitForResult(
    task: MineruTaskRef,
    signal?: AbortSignal,
  ): Promise<MineruTaskResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      signal?.throwIfAborted();
      const path = task.kind === 'single'
        ? `/api/v4/extract/task/${encodeURIComponent(task.id)}`
        : `/api/v4/extract-results/batch/${encodeURIComponent(task.id)}`;
      const body = await this.requestJson(path, {
        headers: this.authHeaders(),
        signal,
      }, 'MINERU_POLL_HTTP');
      const data = responseData(body, 'MINERU_POLL_INVALID');
      const resultData = task.kind === 'single'
        ? data
        : selectBatchResult(data, task.dataId);
      const result = normalizeResult(resultData);
      if (result.state === 'done' || result.state === 'failed') return result;
      if (attempt + 1 < this.maxPollAttempts) {
        await this.sleepWithSignal(Math.min(
          this.maxPollDelayMs,
          this.initialPollDelayMs * 2 ** attempt,
        ), signal);
      }
    }
    throw new MineruError('MINERU_TIMEOUT');
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.settings.token}` };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'content-type': 'application/json' };
  }

  private async sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await this.sleep(ms);
      return;
    }
    signal.throwIfAborted();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(
        signal.reason ?? new DOMException('The operation was aborted', 'AbortError'),
      );
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    httpCode: string,
  ): Promise<unknown> {
    const fetcher = this.fetcher;
    let response: Response;
    try {
      response = await fetcher(`${this.settings.baseUrl}${path}`, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new MineruError(`${httpCode}_NETWORK`);
    }
    if (!response.ok) throw new MineruError(httpCode, response.status);
    try {
      return await response.json();
    } catch {
      throw new MineruError('MINERU_RESPONSE_INVALID');
    }
  }
}

function responseData(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
    throw new MineruError(code);
  }
  return value.data;
}

function selectBatchResult(
  data: Record<string, unknown>,
  dataId: string,
): Record<string, unknown> {
  if (!Array.isArray(data.extract_result)) throw new MineruError('MINERU_BATCH_INVALID');
  const selected = data.extract_result.find(
    (item) => isRecord(item) && item.data_id === dataId,
  );
  if (!isRecord(selected)) throw new MineruError('MINERU_BATCH_ITEM_MISSING');
  return selected;
}

function normalizeResult(data: Record<string, unknown>): MineruTaskResult {
  if (typeof data.state !== 'string') throw new MineruError('MINERU_STATE_INVALID');
  if (waitingStates.has(data.state)) return { state: 'pending' };
  if (runningStates.has(data.state)) return { state: 'running' };
  if (data.state === 'failed') return { state: 'failed', error: 'MINERU_TASK_FAILED' };
  if (data.state === 'done') {
    if (typeof data.full_zip_url !== 'string' || !data.full_zip_url) {
      throw new MineruError('MINERU_RESULT_URL_MISSING');
    }
    return { state: 'done', fullZipUrl: data.full_zip_url };
  }
  throw new MineruError('MINERU_STATE_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
