import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { DocumentModel } from '../document/model';
import type {
  HistoryEntry,
  ReadingRecord,
  StoredTask,
  StoredTranslation,
  StoredSource,
} from './repositories';

interface WebTranslateDb extends DBSchema {
  documents: {
    key: string;
    value: DocumentModel;
    indexes: { 'by-source-url': string };
  };
  translations: {
    key: string;
    value: StoredTranslation;
    indexes: { 'by-hash': string };
  };
  tasks: {
    key: string;
    value: StoredTask;
    indexes: { 'by-hash': string; 'by-status': StoredTask['status'] };
  };
  reading: {
    key: string;
    value: ReadingRecord;
    indexes: { 'by-hash': string };
  };
  sources: {
    key: string;
    value: StoredSource;
    indexes: { 'by-hash': string };
  };
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { 'by-kind': HistoryEntry['kind']; 'by-last-visited': number };
  };
}

export const dbPromise: Promise<IDBPDatabase<WebTranslateDb>> = openDB<WebTranslateDb>(
  'web-translate',
  5,
  {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        db.createObjectStore('documents', { keyPath: 'id' });
        const translations = db.createObjectStore('translations', { keyPath: 'id' });
        translations.createIndex('by-hash', 'hash');
        const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('by-hash', 'hash');
        tasks.createIndex('by-status', 'status');
        const reading = db.createObjectStore('reading', { keyPath: 'id' });
        reading.createIndex('by-hash', 'hash');
      }
      // v5 合并 dev 的 v3 源缓存与 Dashboard 的独立 v4 历史库。
      // 独立 Dashboard v4 可能尚无源缓存，按实际结构补齐，保留原有数据。
      if (!transaction.objectStore('documents').indexNames.contains('by-source-url')) {
        transaction.objectStore('documents').createIndex('by-source-url', 'sourceUrl');
      }
      if (!db.objectStoreNames.contains('sources')) {
        const sources = db.createObjectStore('sources', { keyPath: 'id' });
        sources.createIndex('by-hash', 'hash');
      }
      if (!db.objectStoreNames.contains('history')) {
        const history = db.createObjectStore('history', { keyPath: 'id' });
        history.createIndex('by-kind', 'kind');
        history.createIndex('by-last-visited', 'lastVisitedAt');
      }
    },
  },
);
