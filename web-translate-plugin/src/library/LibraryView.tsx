import React from 'react';
import { BookmarkButton } from './BookmarkButton';
import { emptyLibrary, folderOptions, type LibraryState } from './model';
import { libraryRequest, type LibraryAction } from './messages';

export function useLibrary() {
  const [state, setState] = React.useState<LibraryState>(emptyLibrary);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(() => {
    void libraryRequest({ kind: 'list' }).then((next) => { setState(next); setError(''); }, (e: unknown) => setError(e instanceof Error ? e.message : '读取失败'));
  }, []);
  React.useEffect(() => { refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [refresh]);
  return { state, setState, error, setError };
}

export function LibraryView() {
  const { state, setState, error, setError } = useLibrary();
  const [selected, setSelected] = React.useState('*');
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [edit, setEdit] = React.useState<{ kind: 'create' | 'rename'; name: string } | null>(null);
  const folder = state.folders.find((f) => f.id === selected);
  const run = async (action: LibraryAction) => {
    setBusy(true); setError('');
    try { setState(await libraryRequest(action)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false; }
    finally { setBusy(false); }
  };
  const needle = query.trim().toLocaleLowerCase();
  const entries = state.bookmarks.filter((b) => needle ? b.name.toLocaleLowerCase().includes(needle) : selected === '*' || b.folderId === selected);
  React.useEffect(() => { if (selected && selected !== '*' && !state.folders.some((f) => f.id === selected)) setSelected('*'); }, [selected, state.folders]);
  return <section className="library-view">
    <header className="panel-header"><p className="eyebrow">Paper library</p><h1>论文库</h1><p>整理值得留下的论文，随时接着读。</p></header>
    <label className="search-field"><span className="visually-hidden">搜索论文库</span><input type="search" placeholder="搜索所有收藏名称" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="library-layout" aria-busy={busy}>
      <nav className="library-folders" aria-label="论文文件夹">
        {[{ id: '*', label: '全部论文' }, ...folderOptions(state.folders)].map((f) => <button key={f.id} type="button" aria-current={selected === f.id ? 'page' : undefined}
          title={f.label} aria-label={f.label} style={{ paddingInlineStart: `${Math.min(folderDepth(f.id, state.folders), 5) * .8 + .5}rem` }}
          onClick={() => { setSelected(f.id); setQuery(''); setEdit(null); }}><span aria-hidden="true">{f.id === '*' ? '▤' : '▱'}</span> {state.folders.find((folder) => folder.id === f.id)?.name ?? f.label}</button>)}
      </nav>
      <div className="library-main">
        <div className="library-tools"><h2>{needle ? '搜索结果' : selected === '*' ? '全部论文' : folder?.name ?? '未分类'} <small>({entries.length})</small></h2>
          <button type="button" disabled={busy} onClick={() => setEdit({ kind: 'create', name: '' })}>新建文件夹</button>
          {folder && <><button type="button" disabled={busy} onClick={() => setEdit({ kind: 'rename', name: folder.name })}>重命名文件夹</button>
            <button type="button" disabled={busy} onClick={async () => {
              if (window.confirm(`删除文件夹「${folder.name}」及所有子文件夹和其中的收藏？阅读记录与缓存会保留。`)) {
                if (await run({ kind: 'delete-folder', id: folder.id })) { setSelected('*'); setEdit(null); }
              }
            }}>删除文件夹</button></>}
        </div>
        {edit && <form className="library-folder-form" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(edit.kind === 'create' ? { kind: 'create-folder', name: edit.name, parentId: folder?.id ?? '' } : { kind: 'rename-folder', id: selected, name: edit.name })) setEdit(null);
        }}><label>{edit.kind === 'create' ? '新文件夹名称' : '文件夹名称'}<input autoFocus required maxLength={300} disabled={busy} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <p>{edit.kind === 'create' ? `创建位置：${folder?.name ?? '根目录'}` : '修改当前文件夹名称'}</p>
          <button type="submit" disabled={busy}>保存文件夹</button><button type="button" disabled={busy} onClick={() => setEdit(null)}>取消</button></form>}
        {entries.map((entry) => <article className="library-row" key={entry.id}>
          <div><h3>{entry.name}</h3><p>{new URL(entry.url).hostname}{needle && ` · ${folderOptions(state.folders).find((f) => f.id === entry.folderId)?.label ?? '未分类'}`}</p></div>
          <div className="library-row-actions"><button type="button" className="primary compact" disabled={busy} onClick={() => void run({ kind: 'open', url: entry.url })}>打开论文</button>
            <BookmarkButton url={entry.url} title={entry.name} library={state} onChange={setState} label="编辑收藏" /></div>
        </article>)}
        {!entries.length && <div className="empty-state"><h2>{needle ? '没有匹配的论文' : '还没有收藏论文'}</h2><p>{needle ? '试试其他名称。' : '在 PDF 工作台点击星标，或从最近阅读收藏论文。'}</p></div>}
      </div>
    </div>
    {error && <p role="alert" className="library-error">{error}</p>}
  </section>;
}

function folderDepth(id: string, folders: LibraryState["folders"]): number {
  let depth = 0; let current = folders.find((f) => f.id === id); const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); depth++; current = folders.find((f) => f.id === current!.parentId); }
  return depth;
}
