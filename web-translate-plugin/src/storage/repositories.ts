import type { DocumentModel } from '../document/model';
import type { MineruTaskRef } from '../providers/mineru/contracts';
import { dbPromise } from './db';

export interface TranslationKey {
  hash: string;
  page: number;
  source: string;
  target: string;
  provider: string;
  model: string;
  schema: number;
}

export interface StoredTranslation extends TranslationKey {
  id: string;
  blocks: unknown;
}

export interface StoredTask {
  id: string;
  type: 'mineru';
  providerTask: MineruTaskRef;
  status: 'parsing' | 'done' | 'failed';
  sourceUrl: string;
  hash: string;
  title: string;
  pageCount: number;
  errorCode?: string;
  updatedAt?: number;
}

export interface ReadingRecord {
  id: string;
  hash: string;
  page: number;
}

export function translationCacheKey(key: TranslationKey): string {
  return JSON.stringify([
    key.hash,
    key.page,
    key.source,
    key.target,
    key.provider,
    key.model,
    key.schema,
  ]);
}

export const documentRepository = {
  async get(id: string): Promise<DocumentModel | undefined> {
    return (await dbPromise).get('documents', id);
  },
  async put(model: DocumentModel): Promise<void> {
    await (await dbPromise).put('documents', model);
  },
  async delete(id: string): Promise<void> {
    await (await dbPromise).delete('documents', id);
  },
};

export const translationRepository = {
  async get(key: TranslationKey): Promise<StoredTranslation | undefined> {
    return (await dbPromise).get('translations', translationCacheKey(key));
  },
  async put(key: TranslationKey, blocks: unknown): Promise<void> {
    await (await dbPromise).put('translations', {
      ...key,
      id: translationCacheKey(key),
      blocks,
    });
  },
  async deleteByHash(hash: string): Promise<void> {
    const db = await dbPromise;
    const tx = db.transaction('translations', 'readwrite');
    let cursor = await tx.store.index('by-hash').openKeyCursor(hash);
    while (cursor) {
      await tx.store.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const taskRepository = {
  async put(task: StoredTask): Promise<void> {
    await (await dbPromise).put('tasks', task);
  },
  async get(id: string): Promise<StoredTask | undefined> {
    return (await dbPromise).get('tasks', id);
  },
  async listByStatus(status: StoredTask['status']): Promise<StoredTask[]> {
    return (await dbPromise).getAllFromIndex('tasks', 'by-status', status);
  },
};

export const readingRepository = {
  async put(record: ReadingRecord): Promise<void> {
    await (await dbPromise).put('reading', record);
  },
  async get(id: string): Promise<ReadingRecord | undefined> {
    return (await dbPromise).get('reading', id);
  },
};

export async function clearDocumentCache(hash: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(
    ['documents', 'translations', 'tasks', 'reading'],
    'readwrite',
  );
  await tx.objectStore('documents').delete(hash);
  for (const storeName of ['translations', 'tasks', 'reading'] as const) {
    const store = tx.objectStore(storeName);
    let cursor = await store.index('by-hash').openKeyCursor(hash);
    while (cursor) {
      await store.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

export async function clearAllCache(): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(
    ['documents', 'translations', 'tasks', 'reading'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('documents').clear(),
    tx.objectStore('translations').clear(),
    tx.objectStore('tasks').clear(),
    tx.objectStore('reading').clear(),
  ]);
  await tx.done;
}
