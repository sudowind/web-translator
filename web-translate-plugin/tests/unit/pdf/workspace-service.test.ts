import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import { PdfWorkspaceService } from '../../../src/pdf/workspace-service';

const source = { url: 'https://x.test/p.pdf', hash: 'sha256:x', title: 'p.pdf', size: 7, kind: 'remote' as const, bytes: [37, 80, 68, 70, 45, 49, 10] };
const model: DocumentModel = { id: source.hash, sourceUrl: source.url, hash: source.hash, title: source.title, pageCount: 1, pages: [{ id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: 'Hello' }] }] };

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
      getSettings: vi.fn().mockResolvedValue({ openAi: { apiKey: 'secret', baseUrl: 'https://api.test/v1', model: 'm' }, mineru: {}, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
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
      getSettings: vi.fn().mockResolvedValue({ openAi: { apiKey: 'secret', baseUrl: 'https://api.test/v1', model: 'm' }, mineru: {}, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn(), loadMineru: vi.fn(), createOpenAi: vi.fn(), createAgent: vi.fn().mockReturnValue({ ask }),
    });
    await expect(service.handle({ type: 'pdf:agent-ask', hash: source.hash, activePage: 1, selection: 'selected', recentMessages: [], question: 'What?', maxCharacters: 10 }, 7)).resolves.toMatchObject({ answer: 'Answer [p:1]', mode: 'compressed' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ mode: 'compressed' }), 'What?', expect.any(AbortSignal));
  });
});
