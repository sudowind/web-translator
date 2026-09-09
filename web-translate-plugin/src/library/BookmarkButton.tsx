import React from 'react';
import { bookmarkId, emptyLibrary, folderOptions, type LibraryState } from './model';
import { libraryRequest } from './messages';
import './library.css';

export function BookmarkButton({ url, title, lastPage, library, onChange, label }: {
  url: string; title: string; lastPage?: number; library?: LibraryState; onChange?(state: LibraryState): void; label?: string;
}) {
  const [state, setState] = React.useState(library ?? emptyLibrary);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(() => {
    if (!library) void libraryRequest({ kind: 'list' }).then(setState, () => undefined);
  }, [library]);
  React.useEffect(() => { if (library) setState(library); }, [library]);
  React.useEffect(() => {
    refresh(); window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  let saved = false;
  try { saved = state.bookmarks.some((entry) => entry.id === bookmarkId(url)); } catch { /* 尚未取得在线地址 */ }
  return <>
    <button type="button" className="bookmark-trigger" disabled={busy} aria-label={label ?? (saved ? '编辑收藏' : '收藏论文')}
      title={saved ? '编辑收藏' : '收藏论文'} onClick={async () => {
        setBusy(true); setError('');
        try { setState(await libraryRequest({ kind: 'list' })); setEditing(true); }
        catch (e) { setError(e instanceof Error ? e.message : '读取收藏失败'); }
        finally { setBusy(false); }
      }}><span aria-hidden="true">{saved ? '★' : '☆'}</span>{label && <span>{label}</span>}</button>
    {error && <span role="alert" className="library-error">{error}</span>}
    {editing && <BookmarkEditor url={url} title={title} lastPage={lastPage} initial={state}
      onClose={() => setEditing(false)} onChange={(next) => { setState(next); onChange?.(next); }} />}
  </>;
}

function BookmarkEditor({ url, title, lastPage, initial, onClose, onChange }: {
  url: string; title: string; lastPage?: number; initial: LibraryState; onClose(): void; onChange(state: LibraryState): void;
}) {
  const existing = initial.bookmarks.find((b) => b.id === bookmarkId(url));
  const [state, setState] = React.useState(initial);
  const [name, setName] = React.useState(existing?.name ?? title);
  const [folderId, setFolder] = React.useState(existing?.folderId ?? initial.lastFolderId);
  const [newFolder, setNewFolder] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => { dialog.current?.showModal(); }, []);
  const run = async (action: () => Promise<LibraryState>, close = true) => {
    setBusy(true); setError('');
    try { const next = await action(); setState(next); onChange(next); if (close) onClose(); return next; }
    catch (e) { setError(e instanceof Error ? e.message : '收藏操作失败'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="library-dialog" aria-label={existing ? '编辑论文收藏' : '收藏论文'}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void run(() => libraryRequest({ kind: 'save', url, name, folderId, ...(lastPage ? { lastPage } : {}) })); }}>
      <h2>{existing ? '编辑收藏' : '收藏论文'}</h2>
      <fieldset disabled={busy}>
        <label>收藏名称<input autoFocus required maxLength={300} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>文件夹<select value={folderId} onChange={(e) => setFolder(e.target.value)}>
          {folderOptions(state.folders).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select></label>
        {newFolder === null ? <button type="button" onClick={() => setNewFolder('')}>新建文件夹</button> :
          <div className="library-new-folder"><label>新文件夹名称<input maxLength={300} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} /></label>
            <small>将在当前选择的文件夹下创建</small>
            <button type="button" disabled={!newFolder.trim()} onClick={async () => {
              const next = await run(() => libraryRequest({ kind: 'create-folder', name: newFolder, parentId: folderId }), false);
              if (next) {
                const added = next.folders.find((f) => !state.folders.some((old) => old.id === f.id));
                if (added) setFolder(added.id);
                setNewFolder(null);
              }
            }}>创建</button><button type="button" onClick={() => setNewFolder(null)}>放弃新建</button></div>}
        <div className="library-dialog-actions">
          {existing && <button type="button" onClick={() => void run(() => libraryRequest({ kind: 'remove', url }))}>取消收藏</button>}
          <button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">完成</button>
        </div>
      </fieldset>
      {error && <p role="alert" className="library-error">{error}</p>}
    </form>
  </dialog>;
}
