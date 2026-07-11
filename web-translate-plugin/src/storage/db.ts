import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { DocumentModel } from '../document/model';
import type {
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
}

export const dbPromise: Promise<IDBPDatabase<WebTranslateDb>> = openDB<WebTranslateDb>(
  'web-translate',
  1,
  {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'id' });
      const translations = db.createObjectStore('translations', { keyPath: 'id' });
      translations.createIndex('by-hash', 'hash');
      const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
      tasks.createIndex('by-hash', 'hash');
      tasks.createIndex('by-status', 'status');
      const reading = db.createObjectStore('reading', { keyPath: 'id' });
      reading.createIndex('by-hash', 'hash');
    },
  },
);
