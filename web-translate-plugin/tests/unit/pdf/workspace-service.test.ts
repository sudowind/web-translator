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
});
