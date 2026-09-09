import { normalizeHistoryUrl } from '../history/model';
import { resolveArxivSource } from '../pdf/arxiv-source';

export interface Bookmark { id: string; url: string; name: string; folderId: string; createdAt: number; lastPage?: number }
export interface BookmarkFolder { id: string; name: string; parentId: string }
export interface LibraryState { bookmarks: Bookmark[]; folders: BookmarkFolder[]; lastFolderId: string }
export const emptyLibrary: LibraryState = { bookmarks: [], folders: [], lastFolderId: '' };
export function bookmarkId(url: string): string {
  const normalized = normalizeHistoryUrl(url);
  return resolveArxivSource(normalized)?.key ?? normalized;
}
export function folderOptions(folders: BookmarkFolder[]): Array<{ id: string; label: string }> {
  const result = [{ id: '', label: '未分类' }];
  const visit = (parent: string, path: string, seen: Set<string>) => {
    for (const folder of folders.filter((item) => item.parentId === parent)) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      const label = path ? `${path} / ${folder.name}` : folder.name;
      result.push({ id: folder.id, label });
      visit(folder.id, label, seen);
    }
  };
  visit('', '', new Set());
  return result;
}
