import 'fake-indexeddb/auto';

import { deleteDB, openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';

describe('release 集成数据库升级', () => {
  it.each([0, 2, 3, 4])('从版本 %i 升级，保留既有数据并补齐源缓存与历史库', async (version) => {
    await deleteDB('web-translate');
    if (version > 0) {
      const legacy = await openDB('web-translate', version, {
        upgrade(db) {
          const documents = db.createObjectStore('documents', { keyPath: 'id' });
          db.createObjectStore('translations', { keyPath: 'id' }).createIndex('by-hash', 'hash');
          const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
          tasks.createIndex('by-hash', 'hash');
          tasks.createIndex('by-status', 'status');
          db.createObjectStore('reading', { keyPath: 'id' }).createIndex('by-hash', 'hash');
          if (version === 3) {
            documents.createIndex('by-source-url', 'sourceUrl');
            db.createObjectStore('sources', { keyPath: 'id' }).createIndex('by-hash', 'hash');
          }
          if (version === 4) {
            const history = db.createObjectStore('history', { keyPath: 'id' });
            history.createIndex('by-kind', 'kind');
            history.createIndex('by-last-visited', 'lastVisitedAt');
          }
        },
      });
      await legacy.put('documents', { id: 'existing', sourceUrl: 'https://example.test/p.pdf' });
      await legacy.put('translations', { id: 'translation', hash: 'existing', blocks: ['译文'] });
      if (version === 3) await legacy.put('sources', { id: 'source', hash: 'existing' });
      if (version === 4) await legacy.put('history', { id: 'history', kind: 'pdf', lastVisitedAt: 42 });
      legacy.close();
    }
    vi.resetModules();
    const { dbPromise } = await import('../../../src/storage/db');
    const db = await dbPromise;
    try {
      expect(db.version).toBe(5);
      expect(Array.from(db.objectStoreNames)).toEqual(['documents', 'history', 'reading', 'sources', 'tasks', 'translations']);
      expect(db.transaction('documents').store.indexNames.contains('by-source-url')).toBe(true);
      expect(db.transaction('sources').store.indexNames.contains('by-hash')).toBe(true);
      expect(Array.from(db.transaction('history').store.indexNames)).toEqual(['by-kind', 'by-last-visited']);
      if (version > 0) {
        expect(await db.getFromIndex('documents', 'by-source-url', 'https://example.test/p.pdf')).toMatchObject({ id: 'existing' });
        expect(await db.get('translations', 'translation')).toMatchObject({ blocks: ['译文'] });
      }
      if (version === 3) expect(await db.get('sources', 'source')).toMatchObject({ hash: 'existing' });
      if (version === 4) expect(await db.get('history', 'history')).toMatchObject({ lastVisitedAt: 42 });
    } finally {
      db.close();
      await deleteDB('web-translate');
    }
  });
});
