import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { DOCUMENT_SCHEMA_VERSION, type DocumentModel } from '../../../src/document/model';
import {
  clearAllCache,
  clearDocumentCache,
  documentRepository,
  getStorageSummary,
  historyRepository,
  readingRepository,
  sourceRepository,
  taskRepository,
  translationCacheKey,
  translationRepository,
} from '../../../src/storage/repositories';

const model: DocumentModel = {
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  id: 'hash|one',
  sourceUrl: 'https://example.test/p.pdf',
  hash: 'hash|one',
  title: 'P',
  pageCount: 1,
  pages: [{ id: 'hash|one:p1', index: 0, blocks: [] }],
};

beforeEach(async () => {
  await clearAllCache();
  await historyRepository.clear();
});

describe('PDF IndexedDB 仓储', () => {
  it('缓存键隔离所有维度且不会因分隔符碰撞', () => {
    const base = { hash: 'h', page: 1, source: 'en', target: 'zh-CN', provider: 'openai', model: 'm1', schema: 1 };
    for (const changed of [
      { hash: 'h2' }, { page: 2 }, { source: 'fr' }, { target: 'ja' },
      { provider: 'other' }, { model: 'm2' }, { schema: 2 },
    ]) {
      expect(translationCacheKey(base)).not.toBe(translationCacheKey({ ...base, ...changed }));
    }
    expect(translationCacheKey({ ...base, hash: 'a|b', source: 'c' })).not.toBe(
      translationCacheKey({ ...base, hash: 'a', source: 'b|c' }),
    );
  });

  it('保存并读取文档、源映射、译文及判别任务引用，支持按状态恢复', async () => {
    const key = { hash: model.hash, page: 0, source: 'en', target: 'zh-CN', provider: 'openai', model: 'm', schema: 1 };
    await documentRepository.put(model);
    await sourceRepository.put({
      id: 'arxiv:2510.12403', hash: model.hash, sourceUrl: 'https://arxiv.org/pdf/2510.12403',
      revision: 'etag:"one"', updatedAt: 1,
    });
    await translationRepository.put(key, [{ id: 'b1', text: '译文' }]);
    await taskRepository.put({
      id: 'task-1', type: 'mineru', providerTask: { kind: 'batch', id: 'batch-1', dataId: 'data-1' },
      status: 'parsing', sourceUrl: model.sourceUrl, hash: model.hash, title: model.title, pageCount: 1,
    });

    await expect(documentRepository.get(model.hash)).resolves.toEqual(model);
    await expect(documentRepository.listBySourceUrl(model.sourceUrl)).resolves.toEqual([model]);
    await expect(sourceRepository.get('arxiv:2510.12403')).resolves.toMatchObject({ hash: model.hash, revision: 'etag:"one"' });
    await expect(translationRepository.get(key)).resolves.toMatchObject({ blocks: [{ text: '译文' }] });
    await expect(translationRepository.listByHash(model.hash)).resolves.toMatchObject([
      { hash: model.hash, blocks: [{ text: '译文' }] },
    ]);
    await expect(taskRepository.listByStatus('parsing')).resolves.toMatchObject([
      { providerTask: { kind: 'batch', id: 'batch-1', dataId: 'data-1' } },
    ]);
  });

  it('删除单篇缓存会清理五个 store 中对应 hash', async () => {
    const key = { hash: model.hash, page: 0, source: 'en', target: 'zh-CN', provider: 'openai', model: 'm', schema: 1 };
    await documentRepository.put(model);
    await sourceRepository.put({ id: 'arxiv:2510.12403', hash: model.hash, sourceUrl: 'https://arxiv.org/pdf/2510.12403', updatedAt: 1 });
    await translationRepository.put(key, []);
    await taskRepository.put({ id: 'task-1', type: 'mineru', providerTask: { kind: 'single', id: 's1' }, status: 'done', sourceUrl: model.sourceUrl, hash: model.hash, title: model.title, pageCount: 1 });
    await readingRepository.put({ id: 'reading-1', hash: model.hash, page: 0 });

    await clearDocumentCache(model.hash);

    await expect(documentRepository.get(model.hash)).resolves.toBeUndefined();
    await expect(sourceRepository.get('arxiv:2510.12403')).resolves.toBeUndefined();
    await expect(translationRepository.get(key)).resolves.toBeUndefined();
    await expect(taskRepository.get('task-1')).resolves.toBeUndefined();
    await expect(readingRepository.get('reading-1')).resolves.toBeUndefined();
  });

  it('历史按最近访问倒序合并，且与运行缓存独立清理', async () => {
    await historyRepository.put({
      id: 'webpage:https://example.test/article', kind: 'webpage',
      url: 'https://example.test/article', title: 'Example article',
      sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 10,
    });
    await historyRepository.put({
      id: 'pdf:hash|one', kind: 'pdf', url: model.sourceUrl, title: model.title,
      sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 20,
      documentHash: model.hash, lastPage: 1, pageCount: 3,
    });
    await historyRepository.put({
      id: 'pdf:hash|one', kind: 'pdf', url: model.sourceUrl, title: 'Updated title',
      sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 30,
      documentHash: model.hash, lastPage: 2, pageCount: 3,
    });

    await expect(historyRepository.listRecent()).resolves.toMatchObject([
      { kind: 'pdf', title: 'Updated title', lastPage: 2, lastVisitedAt: 30 },
      { kind: 'webpage', lastVisitedAt: 10 },
    ]);
    await documentRepository.put(model);
    await clearAllCache();
    await expect(historyRepository.listRecent()).resolves.toHaveLength(2);
    await expect(getStorageSummary()).resolves.toMatchObject({ documents: 0, history: 2 });

    await historyRepository.delete('pdf:hash|one');
    await expect(historyRepository.listRecent()).resolves.toMatchObject([{ kind: 'webpage' }]);
    await historyRepository.clear();
    await expect(historyRepository.listRecent()).resolves.toEqual([]);
  });

  it('清理全部覆盖所有 store', async () => {
    await documentRepository.put(model);
    await sourceRepository.put({ id: 'arxiv:2510.12403', hash: model.hash, sourceUrl: 'https://arxiv.org/pdf/2510.12403', updatedAt: 1 });
    await readingRepository.put({ id: 'reading-1', hash: model.hash, page: 0 });
    await clearAllCache();
    await expect(documentRepository.get(model.hash)).resolves.toBeUndefined();
    await expect(sourceRepository.get('arxiv:2510.12403')).resolves.toBeUndefined();
    await expect(readingRepository.get('reading-1')).resolves.toBeUndefined();
  });
});
