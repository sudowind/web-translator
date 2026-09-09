import { isOptionsPageSender } from '../dashboard/messages';
import { historyUrlWithPage, normalizeHistoryUrl } from '../history/model';
import type { HistoryEntry } from '../storage/repositories';
import { bookmarkId, type LibraryState } from './model';
import type { libraryRepository } from './repository';

export type LibraryAction =
  | { kind: 'list' }
  | { kind: 'save'; url: string; name: string; folderId: string; lastPage?: number }
  | { kind: 'remove'; url: string }
  | { kind: 'open'; url: string }
  | { kind: 'create-folder'; name: string; parentId: string }
  | { kind: 'rename-folder'; id: string; name: string }
  | { kind: 'delete-folder'; id: string };
export type LibraryResponse = { ok: true; value: LibraryState } | { ok: false; error: string };
export interface LibrarySender { id?: string; url?: string; tab?: { id?: number }; frameId?: number; documentId?: string }
export function isLibraryCandidate(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'type' in value && value.type === 'library:action';
}
export function validAction(value: unknown): value is LibraryAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  const fields: Record<string, string[]> = { list: [], save: ['url', 'name', 'folderId'], remove: ['url'], open: ['url'],
    'create-folder': ['name', 'parentId'], 'rename-folder': ['id', 'name'], 'delete-folder': ['id'] };
  if (typeof a.kind !== 'string' || !Object.hasOwn(fields, a.kind)) return false;
  const required = fields[a.kind];
  if (!required.every((key) => typeof a[key] === 'string' && (a[key] as string).length <= (key === 'url' ? 2048 : 300))) return false;
  if (!Object.keys(a).every((key) => key === 'kind' || required.includes(key) || (a.kind === 'save' && key === 'lastPage'))) return false;
  if ('name' in a && !(a.name as string).trim()) return false;
  if ('id' in a && !(a.id as string).trim()) return false;
  if ('lastPage' in a && (!Number.isSafeInteger(a.lastPage) || (a.lastPage as number) < 1)) return false;
  try { if ('url' in a) normalizeHistoryUrl(a.url as string); } catch { return false; }
  return true;
}

export async function dispatchLibraryMessage(candidate: unknown, sender: LibrarySender, optionsUrl: string, ports: {
  repository: typeof libraryRepository;
  verifyWorkspace(sender: LibrarySender): Promise<boolean>;
  listHistory(): Promise<HistoryEntry[]>;
  openUrl(url: string): Promise<void>;
}): Promise<LibraryResponse> {
  try {
    const message = candidate as { type?: unknown; action?: unknown };
    if (!isLibraryCandidate(candidate) || Object.keys(message).some((k) => k !== 'type' && k !== 'action') || !validAction(message.action)) throw new Error('收藏请求无效');
    const action = message.action;
    if (!isOptionsPageSender(sender, optionsUrl)) {
      if (sender.id !== new URL(optionsUrl).hostname || !await ports.verifyWorkspace(sender)) throw new Error('收藏来源无效');
      if (!['list', 'save', 'remove', 'create-folder'].includes(action.kind)) throw new Error('此页面不能管理论文库');
      if ((action.kind === 'save' || action.kind === 'remove') && (!sender.url || bookmarkId(sender.url) !== bookmarkId(action.url))) throw new Error('只能收藏当前论文');
    }
    const repo = ports.repository;
    if (action.kind === 'save') await repo.save(action);
    if (action.kind === 'remove') await repo.remove(action.url);
    if (action.kind === 'create-folder') await repo.createFolder(action.name, action.parentId);
    if (action.kind === 'rename-folder') await repo.renameFolder(action.id, action.name);
    if (action.kind === 'delete-folder') await repo.deleteFolder(action.id);
    const state = await repo.list();
    if (action.kind === 'open') {
      const entry = state.bookmarks.find((b) => b.id === bookmarkId(action.url));
      if (!entry) throw new Error('收藏已不存在');
      const history = (await ports.listHistory()).find((h) => h.kind === 'pdf' && bookmarkId(h.url) === entry.id);
      await ports.openUrl(historyUrlWithPage({ kind: 'pdf', url: normalizeHistoryUrl(entry.url), lastPage: history?.lastPage } as HistoryEntry));
    }
    return { ok: true, value: state };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '收藏操作失败' }; }
}

export async function libraryRequest(action: LibraryAction): Promise<LibraryState> {
  const response = await browser.runtime.sendMessage({ type: 'library:action', action }) as LibraryResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? '无法连接论文库');
  return response.value;
}
