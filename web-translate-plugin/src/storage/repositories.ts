import type { DocumentModel } from '../document/model';
import { isFallbackTitle, withPaperTitle } from '../document/title';
import type { MineruTaskRef } from '../providers/mineru/contracts';
import { dbPromise } from './db';
import { getStorageUsage } from './usage';

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

export interface StoredSource {
  id: string;
  hash: string;
  sourceUrl: string;
  revision?: string;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  kind: 'pdf' | 'webpage';
  url: string;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  lastVisitedAt: number;
  documentHash?: string;
  lastPage?: number;
  pageCount?: number;
}

export interface StorageSummary {
  usageBytes?: number;
  documents: number;
  translations: number;
  tasks: number;
  history: number;
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
    const model = await (await dbPromise).get('documents', id);
    return model ? withPaperTitle(model) : undefined;
  },
  async put(model: DocumentModel): Promise<void> {
    const normalized = withPaperTitle(model);
    const tx = (await dbPromise).transaction(['documents', 'history'], 'readwrite');
    await tx.objectStore('documents').put(normalized);
    for (const entry of await tx.objectStore('history').getAll()) {
      if (entry.kind === 'pdf' && entry.documentHash === normalized.hash) {
        await tx.objectStore('history').put(historyWithTitle(entry, normalized, entry));
      }
    }
    await tx.done;
  },
  async listBySourceUrl(sourceUrl: string): Promise<DocumentModel[]> {
    return (await (await dbPromise).getAllFromIndex('documents', 'by-source-url', sourceUrl)).map(withPaperTitle);
  },
  async delete(id: string): Promise<void> {
    await (await dbPromise).delete('documents', id);
  },
};

export const sourceRepository = {
  async get(id: string): Promise<StoredSource | undefined> {
    return (await dbPromise).get('sources', id);
  },
  async put(source: StoredSource): Promise<void> {
    await (await dbPromise).put('sources', source);
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
  async listByHash(hash: string): Promise<StoredTranslation[]> {
    return (await dbPromise).getAllFromIndex('translations', 'by-hash', hash);
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

export const historyRepository = {
  async put(entry: HistoryEntry): Promise<void> {
    const db = await dbPromise;
    const tx = db.transaction(['history', 'documents'], 'readwrite');
    const existing = await tx.objectStore('history').get(entry.id);
    const merged = { ...existing, ...entry };
    const model = merged.kind === 'pdf' && merged.documentHash ? await tx.objectStore('documents').get(merged.documentHash) : undefined;
    await tx.objectStore('history').put(historyWithTitle(merged, model, existing));
    await tx.done;
  },
  async get(id: string): Promise<HistoryEntry | undefined> {
    const db = await dbPromise;
    const tx = db.transaction(['history', 'documents'], 'readwrite');
    const entry = await tx.objectStore('history').get(id);
    if (!entry) { await tx.done; return; }
    const model = entry.kind === 'pdf' && entry.documentHash ? await tx.objectStore('documents').get(entry.documentHash) : undefined;
    const updated = historyWithTitle(entry, model, entry);
    if (updated.title !== entry.title) await tx.objectStore('history').put(updated);
    await tx.done;
    return updated;
  },
  async listRecent(limit = 200): Promise<HistoryEntry[]> {
    const db = await dbPromise;
    const entries: HistoryEntry[] = [];
    const tx = db.transaction(['history', 'documents'], 'readwrite');
    let cursor = await tx.objectStore('history').index('by-last-visited')
      .openCursor(undefined, 'prev');
    while (cursor && entries.length < limit) {
      const entry = cursor.value;
      const model = entry.kind === 'pdf' && entry.documentHash ? await tx.objectStore('documents').get(entry.documentHash) : undefined;
      const updated = historyWithTitle(entry, model, entry);
      if (updated.title !== entry.title) await cursor.update(updated);
      entries.push(updated);
      cursor = await cursor.continue();
    }
    await tx.done;
    return entries;
  },
  async delete(id: string): Promise<void> {
    await (await dbPromise).delete('history', id);
  },
  async clear(): Promise<void> {
    await (await dbPromise).clear('history');
  },
};

function historyWithTitle(entry: HistoryEntry, model?: DocumentModel, existing?: HistoryEntry): HistoryEntry {
  if (entry.kind !== 'pdf') return entry;
  const candidate = model ? withPaperTitle(model).title : entry.title;
  const title = isFallbackTitle(candidate) && existing && !isFallbackTitle(existing.title) ? existing.title : candidate;
  return title === entry.title ? entry : { ...entry, title };
}

export async function getStorageSummary(): Promise<StorageSummary> {
  const db = await dbPromise;
  const tx = db.transaction(['documents', 'translations', 'tasks', 'history']);
  const [documents, translations, tasks, history] = await Promise.all([
    tx.objectStore('documents').count(),
    tx.objectStore('translations').count(),
    tx.objectStore('tasks').count(),
    tx.objectStore('history').count(),
  ]);
  await tx.done;
  const usageBytes = await getStorageUsage();
  return { documents, translations, tasks, history, ...(usageBytes === undefined ? {} : { usageBytes }) };
}

export async function clearDocumentCache(hash: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(
    ['documents', 'translations', 'tasks', 'reading', 'sources'],
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
  const sources = tx.objectStore('sources');
  let sourceCursor = await sources.index('by-hash').openKeyCursor(hash);
  while (sourceCursor) {
    await sources.delete(sourceCursor.primaryKey);
    sourceCursor = await sourceCursor.continue();
  }
  await tx.done;
}

export async function clearAllCache(): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(
    ['documents', 'translations', 'tasks', 'reading', 'sources'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('documents').clear(),
    tx.objectStore('translations').clear(),
    tx.objectStore('tasks').clear(),
    tx.objectStore('reading').clear(),
    tx.objectStore('sources').clear(),
  ]);
  await tx.done;
}
