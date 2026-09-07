import { openDB, type DBSchema } from 'idb';
import type { ExtensionSettings } from '../settings/schema';

interface Entry { key: string; scope: string; text: string; accessed: number; expires: number; bytes: number }
interface CacheSchema extends DBSchema { entries: { key: string; value: Entry } }
export interface WebpageCache {
  get(key: string): Promise<string | undefined>;
  put(key: string, scope: string, text: string): Promise<void>;
  clear(scope: string): Promise<void>;
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function cacheScope(url: string): Promise<string> {
  const page = new URL(url); page.hash = '';
  return digest(page.href);
}
export async function cacheProfile(settings: ExtensionSettings): Promise<string> {
  // Credential itself never enters persistent storage. Full profile isolates capability/prompt changes.
  return digest(JSON.stringify(['webpage-inline-v2', settings.sourceLanguage, settings.targetLanguage, settings.openAi]));
}
export class IndexedWebpageCache implements WebpageCache {
  private db() {
    return openDB<CacheSchema>('webpage-translation-cache', 1, {
      upgrade(db) { db.createObjectStore('entries', { keyPath: 'key' }); },
    });
  }
  async get(key: string): Promise<string | undefined> {
    const db = await this.db();
    try {
      const tx = db.transaction('entries', 'readwrite');
      const value = await tx.store.get(key);
      if (!value) { await tx.done; return; }
      if (value.expires <= Date.now()) { await tx.store.delete(key); await tx.done; return; }
      value.accessed = Date.now(); await tx.store.put(value); await tx.done;
      return value.text;
    } finally { db.close(); }
  }
  async put(key: string, scope: string, text: string): Promise<void> {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > 8 * 1024 * 1024) return;
    const db = await this.db();
    try {
      const tx = db.transaction('entries', 'readwrite');
      const now = Date.now();
      await tx.store.put({ key, scope, text, bytes, accessed: now, expires: now + 30 * 86400_000 });
      const values = (await tx.store.getAll()).sort((a, b) => a.accessed - b.accessed);
      let total = values.reduce((sum, value) => sum + value.bytes, 0);
      let count = values.length;
      for (const value of values) {
        if (value.expires <= now || count > 2000 || total > 8 * 1024 * 1024) {
          await tx.store.delete(value.key); total -= value.bytes; count--;
        }
      }
      await tx.done;
    } finally { db.close(); }
  }
  async clear(scope: string): Promise<void> {
    const db = await this.db();
    try {
      const tx = db.transaction('entries', 'readwrite');
      for (const value of await tx.store.getAll()) if (value.scope === scope) await tx.store.delete(value.key);
      await tx.done;
    } finally { db.close(); }
  }
}
