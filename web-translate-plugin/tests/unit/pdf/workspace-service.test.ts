import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import { PdfWorkspaceService } from '../../../src/pdf/workspace-service';

const source = { url: 'https://x.test/p.pdf', hash: 'sha256:x', title: 'p.pdf', size: 7, kind: 'remote' as const, bytes: [37, 80, 68, 70, 45, 49, 10] };
const model: DocumentModel = { id: source.hash, sourceUrl: source.url, hash: source.hash, title: source.title, pageCount: 1, pages: [{ id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: 'Hello' }] }] };
const openAiSettings = {
  apiKey: 'secret', baseUrl: 'https://api.test/v1', dialect: 'generic-openai' as const,
  defaultModel: 'm',
  translation: { reasoning: { mode: 'off' as const }, timeoutMs: 30_000 },
  agent: { inheritDefaultModel: true, profile: { model: 'm', reasoning: { mode: 'auto' as const }, timeoutMs: 120_000 } },
};

describe('后台 PDF 工作台服务', () => {
  it('公共源在后台创建 MinerU URL 任务并持久化文档', async () => {
    const putDocument = vi.fn();
    const putTask = vi.fn();
    const service = new PdfWorkspaceService({
      loadSource: vi.fn().mockResolvedValue(source), getDocument: vi.fn(), putDocument,
      clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask,
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 't1' }), waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }) }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ providerTask: { kind: 'single', id: 't1' }, status: 'parsing' }));
    expect(putDocument).toHaveBeenCalledWith(model);
  });

  it('认证源不上传且翻译使用后台设置与缓存', async () => {
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const putTranslation = vi.fn();
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(model), putDocument: vi.fn(), clearCache: vi.fn(),
      getTranslation: vi.fn().mockResolvedValue(undefined), putTranslation, putTask: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ openAi: openAiSettings, mineru: {}, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn(), loadMineru: vi.fn(), createOpenAi: vi.fn().mockReturnValue({ translate }),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source: { ...source, kind: 'authenticated' }, pageCount: 1, consent: false }, 7)).rejects.toMatchObject({ code: 'PDF_AUTH_UPLOAD_REQUIRES_CONSENT' });
    await expect(service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7)).resolves.toEqual([{ id: 'b1', text: '你好' }]);
    expect(translate).toHaveBeenCalledOnce();
    expect(putTranslation).toHaveBeenCalled();
  });

  it('认证源仅在明确 consent 后创建上传任务', async () => {
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const putTask = vi.fn();
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(),
      getTranslation: vi.fn(), putTranslation: vi.fn(), putTask, listTasks: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn(), createUploadTask, waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }) }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source: { ...source, kind: 'authenticated' }, pageCount: 1, consent: false }, 7)).rejects.toMatchObject({ code: 'PDF_AUTH_UPLOAD_REQUIRES_CONSENT' });
    await expect(service.handle({ type: 'pdf:parse-start', source: { ...source, kind: 'authenticated' }, pageCount: 1, consent: true }, 7)).resolves.toEqual(model);
    expect(createUploadTask).toHaveBeenCalledOnce();
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ providerTask: { kind: 'batch', id: 'b1', dataId: 'd1' }, status: 'parsing' }));
  });

  it('公共 URL 失败后只回退一次字节上传', async () => {
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const waitForResult = vi.fn()
      .mockResolvedValueOnce({ state: 'failed', error: 'MINERU_TASK_FAILED' })
      .mockResolvedValueOnce({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' });
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }), createUploadTask, waitForResult }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(createUploadTask).toHaveBeenCalledOnce();
    expect(waitForResult).toHaveBeenCalledTimes(2);
  });

  it('公共 URL 任务创建失败时也只回退一次字节上传', async () => {
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn().mockRejectedValue(new Error('safe fetch failure')), createUploadTask, waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }) }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(createUploadTask).toHaveBeenCalledOnce();
  });

  it('启动恢复 parsing 任务并按内部 id 去重', async () => {
    const task = { id: 'pdf:h', type: 'mineru' as const, providerTask: { kind: 'single' as const, id: 's1' }, status: 'parsing' as const, sourceUrl: source.url, hash: source.hash, title: source.title, pageCount: 1 };
    const waitForResult = vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' });
    const putTask = vi.fn();
    const putDocument = vi.fn();
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn(), putDocument, clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask, listTasks: vi.fn().mockResolvedValue([task, task]),
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn(), createUploadTask: vi.fn(), waitForResult }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    });
    await service.resumePending();
    expect(waitForResult).toHaveBeenCalledOnce();
    expect(putDocument).toHaveBeenCalledWith(model);
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'pdf:h', status: 'done' }));
  });

  it('后台构建整篇上下文并执行问答', async () => {
    const ask = vi.fn().mockResolvedValue('Answer [p:1]');
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn().mockResolvedValue(model), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ openAi: openAiSettings, mineru: {}, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn(), loadMineru: vi.fn(), createOpenAi: vi.fn(), createAgent: vi.fn().mockReturnValue({ ask }),
    });
    await expect(service.handle({ type: 'pdf:agent-ask', hash: source.hash, activePage: 1, selection: 'selected', recentMessages: [], question: 'What?', maxCharacters: 10 }, 7)).resolves.toMatchObject({ answer: 'Answer [p:1]', mode: 'compressed' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ mode: 'compressed' }), 'What?', expect.any(AbortSignal));
  });
});

describe('PDF workspace 生命周期修复波', () => {
  it('URL 创建失败后已使用 upload，upload wait 失败绝不二次上传', async () => {
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const putTask = vi.fn();
    const service = makeService({
      createUrlTask: vi.fn().mockRejectedValue(new Error('url create')),
      createUploadTask,
      waitForResult: vi.fn().mockRejectedValue(new Error('upload wait')),
    }, { putTask });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).rejects.toMatchObject({ code: 'MINERU_UPLOAD_FAILED' });
    expect(createUploadTask).toHaveBeenCalledOnce();
    expect(putTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
  });
  it('公共 URL 轮询异常只回退一次，上传失败安全持久化', async () => {
    const putTask = vi.fn();
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const waitForResult = vi.fn().mockRejectedValueOnce(new Error('url poll')).mockRejectedValueOnce(new Error('secret upload raw'));
    const service = makeService({ createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }), createUploadTask, waitForResult }, { putTask });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).rejects.toMatchObject({ code: 'MINERU_UPLOAD_FAILED' });
    expect(createUploadTask).toHaveBeenCalledOnce();
    expect(putTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', errorCode: 'MINERU_UPLOAD_FAILED' }));
  });

  it('agent-cancel 只取消问答，不影响同 tab 翻译', async () => {
    let agentSignal!: AbortSignal;
    const ask = vi.fn((_context, _question, signal: AbortSignal) => {
      agentSignal = signal;
      return new Promise<string>(() => undefined);
    });
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const service = makeService(undefined, { getDocument: vi.fn().mockResolvedValue(model), createAgent: vi.fn().mockReturnValue({ ask }), createOpenAi: vi.fn().mockReturnValue({ translate }) });
    void service.handle({ type: 'pdf:agent-ask', hash: source.hash, activePage: 1, selection: '', recentMessages: [], question: 'What?', maxCharacters: 1000 }, 7);
    await vi.waitFor(() => expect(ask).toHaveBeenCalled());
    await service.handle({ type: 'pdf:agent-cancel' }, 7);
    expect(agentSignal.aborted).toBe(true);
    await expect(service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7)).resolves.toHaveLength(1);

    void service.handle({ type: 'pdf:agent-ask', hash: source.hash, activePage: 1, selection: '', recentMessages: [], question: 'Again?', maxCharacters: 1000 }, 7);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    await service.handle({ type: 'pdf:cancel' }, 7);
    expect(agentSignal.aborted).toBe(true);
  });

  it('cache-clear 取消旧解析，旧 Promise 不回填 DB', async () => {
    const waitForResult = vi.fn((_task, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const putDocument = vi.fn();
    const clearCache = vi.fn();
    const service = makeService({ createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }), createUploadTask: vi.fn(), waitForResult }, { putDocument, clearCache });
    const parsing = service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7);
    await vi.waitFor(() => expect(waitForResult).toHaveBeenCalled());
    await service.handle({ type: 'pdf:cache-clear', hash: source.hash }, 7);
    await expect(parsing).rejects.toHaveProperty('name', 'AbortError');
    expect(clearCache).toHaveBeenCalledWith(source.hash);
    expect(putDocument).not.toHaveBeenCalled();
  });

  it('clear 排在已启动 document put 后执行，resolve 后旧写不能重建', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const putDocument = vi.fn(async () => { order.push('put-start'); await gate; order.push('put-end'); });
    const clearCache = vi.fn(async () => { order.push('clear'); });
    const service = makeService({
      createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
      createUploadTask: vi.fn(),
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, { putDocument, clearCache });
    const parsing = service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7);
    await vi.waitFor(() => expect(putDocument).toHaveBeenCalled());
    const clearing = service.handle({ type: 'pdf:cache-clear', hash: source.hash }, 7);
    expect(clearCache).not.toHaveBeenCalled();
    release();
    await Promise.allSettled([parsing, clearing]);
    expect(order).toEqual(['put-start', 'put-end', 'clear']);
  });

  it('clear 排在已启动 translation put 后执行，resolve 后旧写不能重建', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const putTranslation = vi.fn(async () => { order.push('put-start'); await gate; order.push('put-end'); });
    const clearCache = vi.fn(async () => { order.push('clear'); });
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(model),
      createOpenAi: vi.fn().mockReturnValue({ translate: vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]) }),
      putTranslation,
      clearCache,
    });
    const translating = service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7);
    await vi.waitFor(() => expect(putTranslation).toHaveBeenCalled());
    const clearing = service.handle({ type: 'pdf:cache-clear', hash: source.hash }, 7);
    expect(clearCache).not.toHaveBeenCalled();
    release();
    await Promise.allSettled([translating, clearing]);
    expect(order).toEqual(['put-start', 'put-end', 'clear']);
  });
});

function makeService(mineru?: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return new PdfWorkspaceService({
    loadSource: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ openAi: openAiSettings, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
    createMineru: vi.fn().mockReturnValue(mineru), loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    ...overrides,
  } as never);
}
