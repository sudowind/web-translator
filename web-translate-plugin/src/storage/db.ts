import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { DocumentModel } from '../document/model';
import type {
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
}

export const dbPromise: Promise<IDBPDatabase<WebTranslateDb>> = openDB<WebTranslateDb>(
  'web-translate',
  3,
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
      if (oldVersion < 3) {
        transaction.objectStore('documents').createIndex('by-source-url', 'sourceUrl');
        const sources = db.createObjectStore('sources', { keyPath: 'id' });
        sources.createIndex('by-hash', 'hash');
      }
    },
  },
);
