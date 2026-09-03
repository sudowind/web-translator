import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { DocumentModel } from '../document/model';
import type {
  HistoryEntry,
  ReadingRecord,
  StoredTask,
  StoredTranslation,
} from './repositories';

interface WebTranslateDb extends DBSchema {
  documents: {
    key: string;
    value: DocumentModel;
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
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { 'by-kind': HistoryEntry['kind']; 'by-last-visited': number };
  };
}

export const dbPromise: Promise<IDBPDatabase<WebTranslateDb>> = openDB<WebTranslateDb>(
  'web-translate',
  4,
  {
    upgrade(db, oldVersion) {
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
      // v3 由并行的 arXiv source identity 迁移占用；history 固定使用 v4。
      if (oldVersion < 4) {
        const history = db.createObjectStore('history', { keyPath: 'id' });
        history.createIndex('by-kind', 'kind');
        history.createIndex('by-last-visited', 'lastVisitedAt');
      }
    },
  },
);
