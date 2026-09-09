import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbPromise } from '../../../src/storage/db';
import { clearAllCache, historyRepository } from '../../../src/storage/repositories';
import { libraryRepository as repo } from '../../../src/library/repository';
import { bookmarkId, folderOptions } from '../../../src/library/model';
import { dispatchLibraryMessage, validAction } from '../../../src/library/messages';

afterEach(async () => {
  const db = await dbPromise;
  for (const store of ['bookmarks', 'bookmarkFolders', 'libraryPreferences', 'history'] as const) await db.clear(store);
  vi.restoreAllMocks();
});
describe('论文收藏存储', () => {
  it('按 arXiv 标识和规范化 URL 去重，保留版本差别', async () => {
    await repo.save({ url: 'https://arxiv.org/pdf/2401.12345v1#page=4', name: '原名', folderId: '', lastPage: 4 });
    await repo.createFolder('Agent', '');
    const folder = (await repo.list()).folders[0];
    await repo.save({ url: 'https://arxiv.org/abs/2401.12345v1', name: '改名', folderId: folder.id });
    expect((await repo.list()).bookmarks).toHaveLength(1);
    expect((await repo.list()).bookmarks[0]).toMatchObject({ name: '改名', lastPage: 4, folderId: folder.id });
    expect((await repo.list()).lastFolderId).toBe(folder.id);
    expect(bookmarkId('https://arxiv.org/pdf/2401.12345v2')).not.toBe(bookmarkId('https://arxiv.org/pdf/2401.12345v1'));
    expect(bookmarkId('https://papers.test/p.pdf#page=2')).toBe(bookmarkId('https://papers.test/p.pdf'));
  });
  it('原子删除子目录和收藏，默认目录回退，历史缓存保留', async () => {
    await repo.createFolder('父目录', ''); const parent = (await repo.list()).folders[0];
    await repo.createFolder('子目录', parent.id); const child = (await repo.list()).folders.find((f) => f.parentId)!;
    await repo.save({ url: 'https://papers.test/a.pdf', name: 'A', folderId: child.id });
    await repo.save({ url: 'https://papers.test/b.pdf', name: 'B', folderId: '' });
    await repo.save({ url: 'https://papers.test/a.pdf', name: 'A', folderId: child.id });
    await historyRepository.put({ id: 'h', kind: 'pdf', url: 'https://papers.test/a.pdf', title: '历史', lastVisitedAt: 1, sourceLanguage: 'en', targetLanguage: 'zh' });
    const db = await dbPromise;
    await db.put('reading', { id: 'r', hash: 'h', page: 8 });
    await repo.deleteFolder(parent.id);
    expect(await repo.list()).toMatchObject({ folders: [], lastFolderId: '' });
    expect((await repo.list()).bookmarks.map((b) => b.name)).toEqual(['B']);
    expect(await db.get('reading', 'r')).toBeDefined();
    expect(await historyRepository.get('h')).toBeDefined();
    await clearAllCache(); await historyRepository.clear();
    expect((await repo.list()).bookmarks).toHaveLength(1);
  });
  it('不存在目录和空名称不写入，支持嵌套路径', async () => {
    await expect(repo.save({ url: 'https://p.test/a', name: 'A', folderId: 'missing' })).rejects.toThrow('文件夹');
    await expect(repo.createFolder(' ', '')).rejects.toThrow('名称');
    expect((await repo.list()).bookmarks).toEqual([]);
    expect(folderOptions([{ id: 'a', name: 'A', parentId: '' }, { id: 'b', name: 'B', parentId: 'a' }])).toContainEqual({ id: 'b', label: 'A / B' });
  });
});
describe('论文收藏消息边界', () => {
  const optionsUrl = 'chrome-extension://extension-id/options.html';
  const sender = { id: 'extension-id', url: optionsUrl };
  const ports = () => ({ repository: repo, verifyWorkspace: vi.fn(async () => false), listHistory: () => historyRepository.listRecent(), openUrl: vi.fn(async (_url: string) => {}) });
  it('拒绝额外字段、非 HTTP 链接、非法页码与未知动作', () => {
    expect(validAction({ kind: 'list', url: 'x' })).toBe(false);
    expect(validAction({ kind: 'save', url: 'javascript:alert(1)', name: 'x', folderId: '' })).toBe(false);
    expect(validAction({ kind: 'save', url: 'https://p.test', name: 'x', folderId: '', lastPage: -1 })).toBe(false);
    expect(validAction({ kind: 'toString' })).toBe(false);
  });
  it('普通页面无法读写，已验证工作台仅能操作当前论文', async () => {
    const p = ports(); const pageSender = { id: 'extension-id', url: 'https://papers.test/a.pdf', tab: { id: 1 }, frameId: 0, documentId: 'd' };
    expect((await dispatchLibraryMessage({ type: 'library:action', action: { kind: 'list' } }, pageSender, optionsUrl, p)).ok).toBe(false);
    p.verifyWorkspace.mockResolvedValue(true);
    const save = { kind: 'save', url: 'https://papers.test/b.pdf', name: 'B', folderId: '' };
    expect((await dispatchLibraryMessage({ type: 'library:action', action: save }, pageSender, optionsUrl, p)).ok).toBe(false);
    expect((await dispatchLibraryMessage({ type: 'library:action', action: { ...save, url: pageSender.url } }, pageSender, optionsUrl, p)).ok).toBe(true);
    expect((await dispatchLibraryMessage({ type: 'library:action', action: { kind: 'delete-folder', id: 'x' } }, pageSender, optionsUrl, p)).ok).toBe(false);
    expect((await dispatchLibraryMessage({ type: 'library:action', action: { kind: 'list' } }, { ...pageSender, id: 'other' }, optionsUrl, p)).ok).toBe(false);
  });
  it('打开收藏优先使用最新历史页码，无历史不覆盖阅读恢复位置', async () => {
    await repo.save({ url: 'https://papers.test/a.pdf', name: 'A', folderId: '', lastPage: 3 });
    await historyRepository.put({ id: 'h', kind: 'pdf', url: 'https://papers.test/a.pdf', title: 'A', lastVisitedAt: 1, lastPage: 9, sourceLanguage: 'en', targetLanguage: 'zh' });
    const p = ports(); const msg = { type: 'library:action', action: { kind: 'open', url: 'https://papers.test/a.pdf' } };
    expect((await dispatchLibraryMessage(msg, sender, optionsUrl, p)).ok).toBe(true);
    expect(p.openUrl).toHaveBeenLastCalledWith('https://papers.test/a.pdf#page=9');
    await historyRepository.clear();
    await dispatchLibraryMessage(msg, sender, optionsUrl, p);
    expect(p.openUrl).toHaveBeenLastCalledWith('https://papers.test/a.pdf');
  });
});
