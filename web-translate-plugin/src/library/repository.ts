import { dbPromise } from '../storage/db';
import { normalizeHistoryUrl } from '../history/model';
import { bookmarkId, type Bookmark, type LibraryState } from './model';

function name(value: string): string {
  const text = value.trim();
  if (!text || text.length > 300) throw new Error('名称需要 1～300 个字符');
  return text;
}
export const libraryRepository = {
  async list(): Promise<LibraryState> {
    const db = await dbPromise;
    const tx = db.transaction(['bookmarks', 'bookmarkFolders', 'libraryPreferences']);
    const [bookmarks, folders, preference] = await Promise.all([
      tx.objectStore('bookmarks').getAll(), tx.objectStore('bookmarkFolders').getAll(),
      tx.objectStore('libraryPreferences').get('last-folder'),
    ]);
    return { bookmarks: bookmarks.sort((a, b) => b.createdAt - a.createdAt), folders,
      lastFolderId: folders.some((f) => f.id === preference?.folderId) ? preference!.folderId : '' };
  },
  async save(input: { url: string; name: string; folderId: string; lastPage?: number }) {
    const title = name(input.name);
    const url = normalizeHistoryUrl(input.url);
    const id = bookmarkId(url);
    const db = await dbPromise;
    const tx = db.transaction(['bookmarks', 'bookmarkFolders', 'libraryPreferences'], 'readwrite');
    if (input.folderId && !await tx.objectStore('bookmarkFolders').get(input.folderId)) throw new Error('文件夹已不存在，请重新选择');
    const existing = await tx.objectStore('bookmarks').get(id);
    const record: Bookmark = { ...existing, id, url, name: title, folderId: input.folderId,
      createdAt: existing?.createdAt ?? Date.now(), lastPage: input.lastPage ?? existing?.lastPage };
    await tx.objectStore('bookmarks').put(record);
    await tx.objectStore('libraryPreferences').put({ id: 'last-folder', folderId: input.folderId });
    await tx.done;
  },
  async remove(url: string) { await (await dbPromise).delete('bookmarks', bookmarkId(url)); },
  async createFolder(title: string, parentId: string) {
    const folderName = name(title);
    const tx = (await dbPromise).transaction('bookmarkFolders', 'readwrite');
    if (parentId && !await tx.store.get(parentId)) throw new Error('父文件夹已不存在');
    await tx.store.put({ id: crypto.randomUUID(), name: folderName, parentId });
    await tx.done;
  },
  async renameFolder(id: string, title: string) {
    const folderName = name(title);
    const tx = (await dbPromise).transaction('bookmarkFolders', 'readwrite');
    const folder = await tx.store.get(id);
    if (!folder) throw new Error('文件夹已不存在');
    await tx.store.put({ ...folder, name: folderName });
    await tx.done;
  },
  async deleteFolder(id: string) {
    if (!id) throw new Error('不能删除未分类');
    const tx = (await dbPromise).transaction(['bookmarks', 'bookmarkFolders', 'libraryPreferences'], 'readwrite');
    const folders = await tx.objectStore('bookmarkFolders').getAll();
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) if (removed.has(folder.parentId) && !removed.has(folder.id)) {
        removed.add(folder.id); changed = true;
      }
    }
    for (const key of removed) await tx.objectStore('bookmarkFolders').delete(key);
    for (const entry of await tx.objectStore('bookmarks').getAll()) {
      if (removed.has(entry.folderId)) await tx.objectStore('bookmarks').delete(entry.id);
    }
    const preference = await tx.objectStore('libraryPreferences').get('last-folder');
    if (preference && removed.has(preference.folderId)) await tx.objectStore('libraryPreferences').delete('last-folder');
    await tx.done;
  },
};
