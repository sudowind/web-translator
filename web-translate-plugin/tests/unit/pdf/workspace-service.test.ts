import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_SCHEMA_VERSION, type DocumentModel } from '../../../src/document/model';
import { PdfWorkspaceService } from '../../../src/pdf/workspace-service';

const source = { url: 'https://x.test/p.pdf', hash: 'sha256:x', title: 'p.pdf', size: 7, kind: 'remote' as const };
const sourceBytes = new TextEncoder().encode('%PDF-1\n');
const loadedSource = { descriptor: source, bytes: sourceBytes };
const model: DocumentModel = { schemaVersion: DOCUMENT_SCHEMA_VERSION, id: source.hash, sourceUrl: source.url, hash: source.hash, title: source.title, pageCount: 1, pages: [{ id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: 'Hello' }] }] };
const mediaModel: DocumentModel = {
  ...model,
  pages: [{
    id: 'p1',
    index: 0,
    blocks: [
      { id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: 'Hello' },
      { id: 't1', pageId: 'p1', order: 1, kind: 'table', text: 'table OCR', caption: 'Table title', html: '<table><tr><td>secret</td></tr></table>' },
      { id: 'f1', pageId: 'p1', order: 2, kind: 'figure', text: 'image OCR', caption: 'Figure title', resourceUrl: 'images/secret.png' },
    ],
  }],
};
const arxivModel: DocumentModel = {
  ...model,
  id: 'arxiv:2510.12403',
  sourceUrl: 'https://arxiv.org/pdf/2510.12403',
  hash: 'arxiv:2510.12403',
};
const staleModel: DocumentModel = { ...model, schemaVersion: DOCUMENT_SCHEMA_VERSION - 1 };
const openAiSettings = {
  apiKey: 'secret', baseUrl: 'https://api.test/v1', dialect: 'generic-openai' as const,
  defaultModel: 'm',
  translation: { reasoning: { mode: 'off' as const }, timeoutMs: 30_000 },
  agent: { inheritDefaultModel: true, profile: { model: 'm', reasoning: { mode: 'auto' as const }, timeoutMs: 120_000 } },
};

describe('后台 PDF 工作台服务', () => {
  it('按显式版本 arXiv 标识直接恢复缓存且不读取 PDF 或发 HEAD', async () => {
    const versioned = { ...arxivModel, id: 'arxiv:2510.12403v2', hash: 'arxiv:2510.12403v2' };
    const loadSource = vi.fn();
    const getSourceRevision = vi.fn();
    const createMineru = vi.fn();
    const service = makeService(undefined, {
      loadSource,
      getDocument: vi.fn(async (hash: string) => hash === versioned.hash ? versioned : undefined),
      getSource: vi.fn(),
      putSource: vi.fn(),
      listDocumentsBySourceUrl: vi.fn(),
      getSourceRevision,
      createMineru,
    });

    await expect(service.handle({
      type: 'pdf:document-resolve', sourceUrl: 'https://arxiv.org/pdf/2510.12403v2.pdf#page=4',
    }, 7)).resolves.toEqual(versioned);
    expect(loadSource).not.toHaveBeenCalled();
    expect(getSourceRevision).not.toHaveBeenCalled();
    expect(createMineru).not.toHaveBeenCalled();
  });

  it('无版本 arXiv 只校验响应头，修订变化时清除旧缓存', async () => {
    const clearCache = vi.fn();
    const putSource = vi.fn();
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(arxivModel),
      getSource: vi.fn().mockResolvedValue({
        id: arxivModel.hash, hash: arxivModel.hash, sourceUrl: arxivModel.sourceUrl,
        revision: 'etag:"old"', updatedAt: 1,
      }),
      putSource,
      listDocumentsBySourceUrl: vi.fn(),
      getSourceRevision: vi.fn().mockResolvedValue('etag:"new"'),
      clearCache,
    });

    await expect(service.handle({
      type: 'pdf:document-resolve', sourceUrl: 'https://arxiv.org/abs/2510.12403',
    }, 7)).resolves.toBeNull();
    expect(clearCache).toHaveBeenCalledWith(arxivModel.hash);
    expect(putSource).toHaveBeenCalledWith(expect.objectContaining({
      id: arxivModel.hash, hash: arxivModel.hash, revision: 'etag:"new"',
    }));
  });

  it('无版本 arXiv 修订探测失败时保留可用缓存', async () => {
    const clearCache = vi.fn();
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(arxivModel),
      getSource: vi.fn().mockResolvedValue({
        id: arxivModel.hash, hash: arxivModel.hash, sourceUrl: arxivModel.sourceUrl,
        revision: 'etag:"old"', updatedAt: 1,
      }),
      putSource: vi.fn(), listDocumentsBySourceUrl: vi.fn(),
      getSourceRevision: vi.fn().mockResolvedValue(undefined), clearCache,
    });

    await expect(service.handle({
      type: 'pdf:document-resolve', sourceUrl: arxivModel.sourceUrl,
    }, 7)).resolves.toEqual(arxivModel);
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('升级前 arXiv 缓存可按源 URL 懒迁移且只做 HEAD', async () => {
    const legacy = { ...arxivModel, id: 'sha256:legacy', hash: 'sha256:legacy' };
    const putSource = vi.fn();
    const listDocumentsBySourceUrl = vi.fn(async (url: string) => url === legacy.sourceUrl ? [legacy] : []);
    const service = makeService(undefined, {
      getDocument: vi.fn(), getSource: vi.fn(), putSource, listDocumentsBySourceUrl,
      getSourceRevision: vi.fn().mockResolvedValue('etag:"current"'),
    });

    await expect(service.handle({
      type: 'pdf:document-resolve', sourceUrl: legacy.sourceUrl,
    }, 7)).resolves.toEqual(legacy);
    expect(putSource).toHaveBeenCalledWith(expect.objectContaining({
      id: 'arxiv:2510.12403', hash: 'sha256:legacy', revision: 'etag:"current"',
    }));
  });

  it('按 arXiv 来源清理时同时删除 legacy SHA 与稳定身份缓存', async () => {
    const clearCache = vi.fn();
    const service = makeService(undefined, {
      getSource: vi.fn().mockResolvedValue({
        id: 'arxiv:2510.12403', hash: 'sha256:legacy', sourceUrl: arxivModel.sourceUrl,
        revision: 'etag:"current"', updatedAt: 1,
      }),
      clearCache,
    });

    await expect(service.handle({
      type: 'pdf:cache-clear-source', sourceUrl: 'https://arxiv.org/abs/2510.12403',
    }, 7)).resolves.toEqual({ cleared: true });
    expect(clearCache.mock.calls).toEqual([
      ['sha256:legacy'],
      ['arxiv:2510.12403'],
    ]);
  });

  it('拒绝用来源清理消息删除非 arXiv 文档', async () => {
    const clearCache = vi.fn();
    const service = makeService(undefined, { clearCache });
    await expect(service.handle({
      type: 'pdf:cache-clear-source', sourceUrl: 'https://example.test/p.pdf',
    }, 7)).rejects.toMatchObject({ code: 'PDF_SOURCE_URL_INVALID' });
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('首次懒迁移尚未写入 alias 时清理来源也会删除旧文档且阻止回填', async () => {
    const legacy = { ...arxivModel, id: 'sha256:legacy', hash: 'sha256:legacy' };
    let stored: DocumentModel | undefined = legacy;
    let releaseRevision!: () => void;
    const revisionGate = new Promise<string>((resolve) => { releaseRevision = () => resolve('etag:"current"'); });
    const getSourceRevision = vi.fn(() => revisionGate);
    const putSource = vi.fn();
    const clearCache = vi.fn(async (hash: string) => {
      if (stored?.hash === hash) stored = undefined;
    });
    const service = makeService(undefined, {
      getSource: vi.fn(), putSource, getSourceRevision, clearCache,
      getDocument: vi.fn(async (hash: string) => stored?.hash === hash ? stored : undefined),
      listDocumentsBySourceUrl: vi.fn(async (url: string) => stored?.sourceUrl === url ? [stored] : []),
    });
    const resolving = service.handle({ type: 'pdf:document-resolve', sourceUrl: legacy.sourceUrl }, 7);
    await vi.waitFor(() => expect(getSourceRevision).toHaveBeenCalled());
    await service.handle({ type: 'pdf:cache-clear-source', sourceUrl: legacy.sourceUrl }, 7);
    releaseRevision();
    await expect(resolving).resolves.toBeNull();
    expect(clearCache).toHaveBeenCalledWith(legacy.hash);
    expect(clearCache).toHaveBeenCalledWith(arxivModel.hash);
    expect(putSource).not.toHaveBeenCalled();
    await expect(service.handle({ type: 'pdf:document-get', hash: legacy.hash }, 8)).resolves.toBeNull();
  });

  it('升级前同 URL 存在多个 hash 时保守视为未命中', async () => {
    const older = { ...arxivModel, id: 'sha256:old', hash: 'sha256:old' };
    const newer = { ...arxivModel, id: 'sha256:new', hash: 'sha256:new' };
    const service = makeService(undefined, {
      getDocument: vi.fn(), getSource: vi.fn(), putSource: vi.fn(),
      listDocumentsBySourceUrl: vi.fn(async (url: string) => url === arxivModel.sourceUrl ? [older, newer] : []),
      getSourceRevision: vi.fn().mockResolvedValue('etag:"current"'),
    });
    await expect(service.handle({
      type: 'pdf:document-resolve', sourceUrl: arxivModel.sourceUrl,
    }, 7)).resolves.toBeNull();
  });

  it('旧索引读取迟于来源清理返回时不能复活已删除模型', async () => {
    const legacy = { ...arxivModel, id: 'sha256:legacy', hash: 'sha256:legacy' };
    let stored: DocumentModel | undefined = legacy;
    let releaseRead!: () => void;
    const readGate = new Promise<DocumentModel[]>((resolve) => { releaseRead = () => resolve([legacy]); });
    const listDocumentsBySourceUrl = vi.fn(async (url: string) => stored?.sourceUrl === url ? [stored] : [])
      .mockImplementationOnce(() => readGate);
    const putSource = vi.fn();
    const service = makeService(undefined, {
      getSource: vi.fn(), putSource, listDocumentsBySourceUrl,
      getDocument: vi.fn(async (hash: string) => stored?.hash === hash ? stored : undefined),
      getSourceRevision: vi.fn().mockResolvedValue('etag:"current"'),
      clearCache: vi.fn(async (hash: string) => { if (stored?.hash === hash) stored = undefined; }),
    });
    const resolving = service.handle({ type: 'pdf:document-resolve', sourceUrl: legacy.sourceUrl }, 7);
    await vi.waitFor(() => expect(listDocumentsBySourceUrl).toHaveBeenCalled());
    await service.handle({ type: 'pdf:cache-clear-source', sourceUrl: legacy.sourceUrl }, 8);
    releaseRead();
    await expect(resolving).resolves.toBeNull();
    expect(putSource).not.toHaveBeenCalled();
    await expect(service.handle({ type: 'pdf:document-get', hash: legacy.hash }, 9)).resolves.toBeNull();
  });

  it('arXiv resolve 等待 HEAD 时并发清缓存不会回填源映射或返回旧模型', async () => {
    let releaseRevision!: () => void;
    const revisionGate = new Promise<string>((resolve) => { releaseRevision = () => resolve('etag:"old"'); });
    const getSourceRevision = vi.fn(() => revisionGate);
    const putSource = vi.fn();
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(arxivModel),
      getSource: vi.fn().mockResolvedValue({
        id: arxivModel.hash, hash: arxivModel.hash, sourceUrl: arxivModel.sourceUrl,
        revision: 'etag:"old"', updatedAt: 1,
      }),
      putSource, listDocumentsBySourceUrl: vi.fn(), getSourceRevision, clearCache: vi.fn(),
    });
    const resolving = service.handle({ type: 'pdf:document-resolve', sourceUrl: arxivModel.sourceUrl }, 7);
    await vi.waitFor(() => expect(getSourceRevision).toHaveBeenCalled());
    await service.handle({ type: 'pdf:cache-clear', hash: arxivModel.hash }, 8);
    releaseRevision();
    await expect(resolving).resolves.toBeNull();
    expect(putSource).not.toHaveBeenCalled();
  });

  it('使用可信发送者 URL 保存 PDF 阅读进度', async () => {
    const recordHistory = vi.fn().mockResolvedValue(undefined);
    const service = makeService(undefined, { recordHistory });

    await expect(service.handle({
      type: 'pdf:history-update', hash: source.hash, title: 'Paper', page: 3, pageCount: 8,
    }, 7, 'https://example.test/p.pdf#page=3')).resolves.toEqual({ historyUpdated: true });

    expect(recordHistory).toHaveBeenCalledWith(expect.objectContaining({
      id: `pdf:${source.hash}`, url: 'https://example.test/p.pdf',
      lastPage: 3, pageCount: 8, sourceLanguage: 'en', targetLanguage: 'zh-CN',
    }));
  });

  it('parse-start 不回传字节，公共 URL 失败后才由后台读取一次上传字节', async () => {
    const loadSource = vi.fn().mockResolvedValue(loadedSource);
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const service = makeService({
      createUrlTask: vi.fn().mockRejectedValue(new Error('url create')),
      createUploadTask,
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, { loadSource });

    await expect(service.handle({
      type: 'pdf:parse-start',
      source,
      pageCount: 1,
      consent: false,
    }, 7)).resolves.toEqual(model);

    expect(loadSource).toHaveBeenCalledOnce();
    expect(createUploadTask).toHaveBeenCalledWith(
      source.title,
      expect.objectContaining({ byteLength: source.size }),
      expect.any(AbortSignal),
    );
  });

  it('后台重取后 hash 变化则拒绝上传', async () => {
    const changed = { ...loadedSource, descriptor: { ...source, hash: 'sha256:changed' } };
    const createUploadTask = vi.fn();
    const service = makeService({
      createUrlTask: vi.fn(),
      createUploadTask,
      waitForResult: vi.fn(),
    }, { loadSource: vi.fn().mockResolvedValue(changed) });

    await expect(service.handle({
      type: 'pdf:parse-start',
      source: { ...source, kind: 'authenticated' },
      pageCount: 1,
      consent: true,
    }, 7)).rejects.toMatchObject({ code: 'PDF_SOURCE_CHANGED' });
    expect(createUploadTask).not.toHaveBeenCalled();
  });

  it('认证 PDF 未同意前后台不读取，同意后才读取一次', async () => {
    const loadSource = vi.fn().mockResolvedValue({ ...loadedSource, descriptor: { ...source, kind: 'authenticated' } });
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const service = makeService({
      createUrlTask: vi.fn(),
      createUploadTask,
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, { loadSource });

    await expect(service.handle({
      type: 'pdf:parse-start', source: { ...source, kind: 'authenticated' }, pageCount: 1, consent: false,
    }, 7)).rejects.toMatchObject({ code: 'PDF_AUTH_UPLOAD_REQUIRES_CONSENT' });
    expect(loadSource).not.toHaveBeenCalled();
    await service.handle({
      type: 'pdf:parse-start',
      source: { ...source, kind: 'authenticated' },
      pageCount: 1,
      consent: true,
    }, 7);

    expect(loadSource).toHaveBeenCalledOnce();
    expect(createUploadTask).toHaveBeenCalledOnce();
  });

  it('当前版本的文档缓存直接命中，不重新请求 MinerU', async () => {
    const createMineru = vi.fn();
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(model),
      createMineru,
    });

    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(createMineru).not.toHaveBeenCalled();
  });

  it('旧版本文档缓存会重新解析并写入当前版本', async () => {
    const putDocument = vi.fn();
    const loadMineru = vi.fn().mockResolvedValue(model);
    const service = makeService({
      createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
      createUploadTask: vi.fn(),
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, {
      getDocument: vi.fn().mockResolvedValue(staleModel),
      putDocument,
      loadMineru,
    });

    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(loadMineru).toHaveBeenCalledOnce();
    expect(putDocument).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: DOCUMENT_SCHEMA_VERSION }));
  });

  it('旧文档重新解析后仍复用同块 ID 的译文缓存', async () => {
    const cachedTranslation = [{ id: 'b1', text: '你好' }];
    const createOpenAi = vi.fn();
    const loadMineru = vi.fn().mockResolvedValue(model);
    const getDocument = vi.fn().mockResolvedValueOnce(staleModel).mockResolvedValue(model);
    const service = makeService({
      createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
      createUploadTask: vi.fn(),
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, {
      getDocument,
      getTranslation: vi.fn().mockResolvedValue({ blocks: cachedTranslation }),
      createOpenAi,
      loadMineru,
    });

    await service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7);
    expect(loadMineru).toHaveBeenCalledOnce();
    await expect(service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7)).resolves.toEqual(cachedTranslation);
    expect(createOpenAi).not.toHaveBeenCalled();
  });

  it('缺少媒体标题 ID 的旧缓存会重新翻译并覆盖媒体页缓存', async () => {
    const cached = [{ id: 'b1', text: '正文译文' }];
    const fresh = [
      { id: 'b1', text: '正文译文' },
      { id: 't1', text: '表格标题' },
      { id: 'f1', text: '图片标题' },
    ];
    const translate = vi.fn().mockResolvedValue(fresh);
    const putTranslation = vi.fn();
    const getTranslation = vi.fn().mockResolvedValue({ blocks: cached });
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(mediaModel),
      getTranslation,
      putTranslation,
      createOpenAi: vi.fn().mockReturnValue({ translate }),
    });

    await expect(service.handle(
      { type: 'pdf:translate-page', hash: source.hash, page: 1 },
      7,
    )).resolves.toEqual(fresh);
    expect(getTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 2 }));
    expect(translate).toHaveBeenCalledOnce();
    expect(putTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 2 }), fresh);
  });

  it('完整媒体缓存直接复用且不创建 LLM 客户端', async () => {
    const cached = [
      { id: 'b1', text: '正文译文' },
      { id: 't1', text: '表格标题' },
      { id: 'f1', text: '图片标题' },
    ];
    const createOpenAi = vi.fn();
    const getTranslation = vi.fn().mockResolvedValue({ blocks: cached });
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(mediaModel),
      getTranslation,
      createOpenAi,
    });

    await expect(service.handle(
      { type: 'pdf:translate-page', hash: source.hash, page: 1 },
      7,
    )).resolves.toEqual(cached);
    expect(getTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 2 }));
    expect(createOpenAi).not.toHaveBeenCalled();
  });

  it('一次快照只返回当前设置下 block ID 完整匹配的页面缓存', async () => {
    const secondPageModel: DocumentModel = {
      ...model,
      pageCount: 2,
      pages: [
        model.pages[0],
        { id: 'p2', index: 1, blocks: [{ id: 'b2', pageId: 'p2', order: 0, kind: 'paragraph', text: 'World' }], },
      ],
    };
    const valid = {
      id: 'valid', hash: source.hash, page: 1, source: 'en', target: 'zh-CN', provider: 'openai', model: 'm', schema: 1,
      blocks: [{ id: 'b1', text: '你好' }],
    };
    const incomplete = {
      ...valid, id: 'incomplete', page: 2, blocks: [],
    };
    const wrongModel = {
      ...valid, id: 'wrong-model', page: 2, model: 'other', blocks: [{ id: 'b2', text: '世界' }],
    };
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(secondPageModel),
      listTranslations: vi.fn().mockResolvedValue([valid, incomplete, wrongModel]),
    });

    await expect(service.handle({ type: 'pdf:translation-snapshot', hash: source.hash }, 7)).resolves.toEqual({
      pages: [{ page: 1, blocks: [{ id: 'b1', text: '你好' }] }],
    });
  });

  it('翻译和 Agent 在同一 Service Worker 生命周期复用文档模型', async () => {
    const getDocument = vi.fn().mockResolvedValue(model);
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const ask = vi.fn().mockResolvedValue('Answer');
    const service = makeService(undefined, {
      getDocument,
      createOpenAi: vi.fn().mockReturnValue({ translate }),
      createAgent: vi.fn().mockReturnValue({ ask }),
    });

    await service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7);
    await service.handle({ type: 'pdf:agent-ask', hash: source.hash, requestId: 'agent-1', activePage: 1, selection: '', recentMessages: [], question: 'What?', maxCharacters: 1000 }, 7);
    expect(getDocument).toHaveBeenCalledOnce();
  });

  it('文档模型 LRU 最多保留三份并在清缓存时失效', async () => {
    const getDocument = vi.fn(async (hash: string) => ({ ...model, id: hash, hash }));
    const service = makeService(undefined, { getDocument });
    for (const hash of ['h1', 'h2', 'h3', 'h1', 'h4', 'h2']) {
      await service.handle({ type: 'pdf:document-get', hash }, 7);
    }
    expect(getDocument.mock.calls.map(([hash]) => hash)).toEqual(['h1', 'h2', 'h3', 'h4', 'h2']);
    await service.handle({ type: 'pdf:cache-clear', hash: 'h1' }, 7);
    await service.handle({ type: 'pdf:document-get', hash: 'h1' }, 7);
    expect(getDocument.mock.calls.filter(([hash]) => hash === 'h1')).toHaveLength(2);
  });

  it.each([
    ['重复 ID', [{ id: 'b1', text: '一' }, { id: 'b1', text: '二' }, { id: 't1', text: '表格' }, { id: 'f1', text: '图片' }]],
    ['额外 ID', [{ id: 'b1', text: '正文' }, { id: 't1', text: '表格' }, { id: 'f1', text: '图片' }, { id: 'old-table', text: '旧表格' }]],
  ])('媒体缓存包含%s时重新翻译', async (_case, blocks) => {
    const fresh = [
      { id: 'b1', text: '正文' },
      { id: 't1', text: '表格' },
      { id: 'f1', text: '图片' },
    ];
    const translate = vi.fn().mockResolvedValue(fresh);
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(mediaModel),
      getTranslation: vi.fn().mockResolvedValue({ blocks }),
      createOpenAi: vi.fn().mockReturnValue({ translate }),
    });

    await expect(service.handle(
      { type: 'pdf:translate-page', hash: source.hash, page: 1 },
      7,
    )).resolves.toEqual(fresh);
    expect(translate).toHaveBeenCalledOnce();
  });

  it('纯文本页继续使用翻译缓存 schema 1', async () => {
    const cached = [{ id: 'b1', text: '你好' }];
    const getTranslation = vi.fn().mockResolvedValue({ blocks: cached });
    const service = makeService(undefined, {
      getDocument: vi.fn().mockResolvedValue(model),
      getTranslation,
    });

    await expect(service.handle(
      { type: 'pdf:translate-page', hash: source.hash, page: 1 },
      7,
    )).resolves.toEqual(cached);
    expect(getTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 1 }));
  });

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
      loadSource: vi.fn().mockResolvedValue({ ...loadedSource, descriptor: { ...source, kind: 'authenticated' } }), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(),
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
      loadSource: vi.fn().mockResolvedValue(loadedSource), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({ openAi: {}, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn().mockReturnValue({ createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }), createUploadTask, waitForResult }),
      loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    });
    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7)).resolves.toEqual(model);
    expect(createUploadTask).toHaveBeenCalledOnce();
    expect(waitForResult).toHaveBeenCalledTimes(2);
  });

  it('公共 URL 轮询失败后的上传回退原样保留 PDF_SOURCE_CHANGED', async () => {
    const putTask = vi.fn();
    const createUploadTask = vi.fn();
    const changed = { ...loadedSource, descriptor: { ...source, hash: 'sha256:changed' } };
    const service = makeService({
      createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
      createUploadTask,
      waitForResult: vi.fn().mockResolvedValue({ state: 'failed', error: 'MINERU_TASK_FAILED' }),
    }, { loadSource: vi.fn().mockResolvedValue(changed), putTask });

    await expect(service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7))
      .rejects.toMatchObject({ code: 'PDF_SOURCE_CHANGED' });
    expect(createUploadTask).not.toHaveBeenCalled();
    expect(putTask).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: 'PDF_SOURCE_CHANGED' }));
  });

  it('公共 URL 任务创建失败时也只回退一次字节上传', async () => {
    const createUploadTask = vi.fn().mockResolvedValue({ kind: 'batch', id: 'b1', dataId: 'd1' });
    const service = new PdfWorkspaceService({
      loadSource: vi.fn().mockResolvedValue(loadedSource), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
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
    const reportAgentProgress = vi.fn();
    const ask = vi.fn(async (_context, _question, _signal, onDelta: (delta: string) => void) => {
      onDelta('Answer ');
      onDelta('[p:1]');
      return 'Answer [p:1]';
    });
    const service = new PdfWorkspaceService({
      loadSource: vi.fn(), getDocument: vi.fn().mockResolvedValue(model), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ openAi: openAiSettings, mineru: {}, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
      createMineru: vi.fn(), loadMineru: vi.fn(), createOpenAi: vi.fn(), createAgent: vi.fn().mockReturnValue({ ask }), reportAgentProgress,
    });
    await expect(service.handle({ type: 'pdf:agent-ask', hash: source.hash, requestId: 'agent-1', activePage: 1, selection: 'selected', recentMessages: [], question: 'What?', maxCharacters: 10 }, 7)).resolves.toMatchObject({ answer: 'Answer [p:1]', mode: 'compressed' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ mode: 'compressed' }), 'What?', expect.any(AbortSignal), expect.any(Function));
    expect(reportAgentProgress.mock.calls).toEqual([
      [7, { type: 'pdf:agent-progress', hash: source.hash, requestId: 'agent-1', delta: 'Answer ' }],
      [7, { type: 'pdf:agent-progress', hash: source.hash, requestId: 'agent-1', delta: '[p:1]' }],
    ]);
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
    void service.handle({ type: 'pdf:agent-ask', hash: source.hash, requestId: 'agent-1', activePage: 1, selection: '', recentMessages: [], question: 'What?', maxCharacters: 1000 }, 7);
    await vi.waitFor(() => expect(ask).toHaveBeenCalled());
    await service.handle({ type: 'pdf:agent-cancel' }, 7);
    expect(agentSignal.aborted).toBe(true);
    await expect(service.handle({ type: 'pdf:translate-page', hash: source.hash, page: 1 }, 7)).resolves.toHaveLength(1);

    void service.handle({ type: 'pdf:agent-ask', hash: source.hash, requestId: 'agent-2', activePage: 1, selection: '', recentMessages: [], question: 'Again?', maxCharacters: 1000 }, 7);
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

  it('cache-clear 期间的其他标签读取等待清理屏障且不回填旧 LRU', async () => {
    let stored: DocumentModel | undefined = model;
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const getDocument = vi.fn(async () => stored);
    const clearCache = vi.fn(async () => {
      await clearGate;
      stored = undefined;
    });
    const service = makeService(undefined, { getDocument, clearCache });

    const clearing = service.handle({ type: 'pdf:cache-clear', hash: source.hash }, 7);
    const reading = service.handle({ type: 'pdf:document-get', hash: source.hash }, 8);
    await Promise.resolve();
    expect(getDocument).not.toHaveBeenCalled();
    releaseClear();
    await expect(clearing).resolves.toEqual({ cleared: true });
    await expect(reading).resolves.toBeNull();
    expect(getDocument).toHaveBeenCalledOnce();
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

  it('arXiv document put 与清理并发时不回填源映射或 LRU', async () => {
    const arxivSource = {
      url: arxivModel.sourceUrl, hash: arxivModel.hash, title: arxivModel.title, size: 0, kind: 'remote' as const,
    };
    let stored: DocumentModel | undefined;
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    const putDocument = vi.fn(async (value: DocumentModel) => {
      await putGate;
      stored = value;
    });
    const clearCache = vi.fn(async () => { stored = undefined; });
    const putSource = vi.fn();
    const service = makeService({
      createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
      createUploadTask: vi.fn(),
      waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
    }, {
      getDocument: vi.fn(async () => stored), putDocument, clearCache, putSource,
      getSource: vi.fn(), loadMineru: vi.fn().mockResolvedValue(arxivModel),
    });
    const parsing = service.handle({ type: 'pdf:parse-start', source: arxivSource, pageCount: 1, consent: false }, 7);
    await vi.waitFor(() => expect(putDocument).toHaveBeenCalled());
    const clearing = service.handle({ type: 'pdf:cache-clear', hash: arxivModel.hash }, 8);
    releasePut();
    await expect(parsing).rejects.toHaveProperty('name', 'AbortError');
    await clearing;
    expect(putSource).not.toHaveBeenCalled();
    await expect(service.handle({ type: 'pdf:document-get', hash: arxivModel.hash }, 9)).resolves.toBeNull();
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
    loadSource: vi.fn().mockResolvedValue(loadedSource), getDocument: vi.fn(), putDocument: vi.fn(), clearCache: vi.fn(), getTranslation: vi.fn(), listTranslations: vi.fn().mockResolvedValue([]), putTranslation: vi.fn(), putTask: vi.fn(), listTasks: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ openAi: openAiSettings, mineru: { baseUrl: 'https://mineru.net', token: 'secret', modelVersion: 'vlm' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
    createMineru: vi.fn().mockReturnValue(mineru), loadMineru: vi.fn().mockResolvedValue(model), createOpenAi: vi.fn(), createAgent: vi.fn(),
    ...overrides,
  } as never);
}
