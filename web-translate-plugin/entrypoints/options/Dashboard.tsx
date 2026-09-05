import { useEffect, useMemo, useState } from 'react';

import type { DashboardMessage, DashboardResponse, DashboardState } from '../../src/dashboard/messages';
import type { HistoryEntry } from '../../src/storage/repositories';
import SettingsPanel, { type SettingsSection } from './App';

type DashboardSection = 'history' | 'providers' | 'translation' | 'pdf' | 'storage';
type HistoryFilter = 'all' | HistoryEntry['kind'];

const emptyState: DashboardState = {
  entries: [],
  summary: { documents: 0, translations: 0, tasks: 0, history: 0 },
};

const navigation: Array<{ id: DashboardSection; label: string; note: string }> = [
  { id: 'history', label: '最近阅读', note: '继续翻译过的内容' },
  { id: 'providers', label: 'AI 服务', note: '模型与智能体' },
  { id: 'translation', label: '翻译偏好', note: '语言与响应速度' },
  { id: 'pdf', label: 'PDF 解析', note: 'MinerU 服务' },
  { id: 'storage', label: '存储与隐私', note: '本地数据管理' },
];

export default function Dashboard({ initialSection }: { initialSection?: DashboardSection }) {
  const [section, setSection] = useState<DashboardSection>(initialSection ?? initialDashboardSection());
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('正在读取本地记录');

  useEffect(() => {
    const onHashChange = () => setSection(initialDashboardSection());
    globalThis.addEventListener('hashchange', onHashChange);
    return () => globalThis.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    void runDashboardAction({ type: 'dashboard:get-state' }).then((value) => {
      if ('entries' in value) setState(value);
      setFeedback('本地记录已更新');
    }, (error: unknown) => setFeedback(`读取失败：${errorText(error)}`)).finally(() => setLoading(false));
  }, []);

  function navigate(next: DashboardSection) {
    setSection(next);
    if (typeof location !== 'undefined') history.replaceState(null, '', `#${next}`);
  }

  async function mutate(message: DashboardMessage, success: string) {
    setLoading(true);
    try {
      const value = await runDashboardAction(message);
      if ('entries' in value) setState(value);
      setFeedback(success);
    } catch (error) {
      setFeedback(`操作失败：${errorText(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">译</span>
          <div><strong>Web Translate</strong><span>阅读控制台</span></div>
        </div>
        <nav aria-label="控制台分区">
          {navigation.map((item) => (
            <button key={item.id} type="button" className="nav-item" data-active={section === item.id}
              aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
              <span>{item.label}</span><small>{item.note}</small>
            </button>
          ))}
        </nav>
        <p className="local-note"><span aria-hidden="true">●</span> 数据只保存在此浏览器</p>
      </aside>

      <div className="dashboard-content">
        {section === 'history' && <HistoryView entries={state.entries} loading={loading}
          onOpen={(id) => void mutate({ type: 'dashboard:open-history', id }, '已在新标签页打开')}
          onDelete={(id) => void mutate({ type: 'dashboard:delete-history', id }, '历史记录已删除')} />}
        {(section === 'providers' || section === 'translation' || section === 'pdf') &&
          <SettingsPanel section={section as SettingsSection} />}
        {section === 'storage' && <StorageView state={state} loading={loading}
          onClearHistory={() => void mutate({ type: 'dashboard:clear-history' }, '翻译历史已清空')}
          onClearCache={() => void mutate({ type: 'dashboard:clear-cache' }, 'PDF 运行缓存已清空')} />}
        <p className="dashboard-feedback" aria-live="polite">{feedback}</p>
      </div>
    </main>
  );
}

function HistoryView({ entries, loading, onOpen, onDelete }: {
  entries: HistoryEntry[]; loading: boolean; onOpen(id: string): void; onDelete(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const visible = useMemo(() => filterHistoryEntries(entries, query, filter), [entries, filter, query]);
  return <section className="history-view">
    <header className="history-hero panel-header">
      <p className="eyebrow">Reading ledger</p>
      <h1>把读过的东西，接着读下去。</h1>
      <p>这里只记录你主动使用插件翻译过的 PDF 和网页。</p>
    </header>
    <div className="history-tools">
      <label className="search-field"><span className="visually-hidden">搜索历史</span>
        <input type="search" placeholder="搜索标题或网站" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="segmented" aria-label="历史类型">
        {([['all', '全部'], ['pdf', 'PDF'], ['webpage', '网页']] as const).map(([value, label]) =>
          <button key={value} type="button" data-active={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
    </div>
    <div className="history-ledger" aria-busy={loading}>
      {visible.length === 0 ? <div className="empty-state"><span aria-hidden="true">↗</span>
        <h2>{loading ? '正在整理阅读记录' : '还没有翻译记录'}</h2>
        <p>{loading ? '记录会按最近阅读时间排列。' : '在任意网页或 PDF 中启用翻译后，它会出现在这里。'}</p>
      </div> : visible.map((entry) => <HistoryRow key={entry.id} entry={entry} onOpen={onOpen} onDelete={onDelete} />)}
    </div>
  </section>;
}

function HistoryRow({ entry, onOpen, onDelete }: { entry: HistoryEntry; onOpen(id: string): void; onDelete(id: string): void }) {
  const progress = entry.kind === 'pdf' && entry.lastPage && entry.pageCount
    ? Math.min(100, Math.round(entry.lastPage / entry.pageCount * 100)) : undefined;
  return <article className="history-row">
    <div className="history-kind" data-kind={entry.kind}>{entry.kind === 'pdf' ? 'PDF' : 'WEB'}</div>
    <div className="history-main">
      <h2>{entry.title}</h2>
      <p>{hostLabel(entry.url)} · {relativeTime(entry.lastVisitedAt)} · {entry.sourceLanguage} → {entry.targetLanguage}</p>
      {progress !== undefined && <div className="reading-progress" aria-label={`阅读进度 ${progress}%`}>
        <div className="reading-progress-track"><span style={{ width: `${progress}%` }} /></div>
        <small>第 {entry.lastPage} / {entry.pageCount} 页</small>
      </div>}
    </div>
    <div className="history-actions">
      <button className="primary compact" type="button" onClick={() => onOpen(entry.id)}>重新打开</button>
      <button className="quiet compact" type="button" aria-label={`删除 ${entry.title}`} onClick={() => onDelete(entry.id)}>删除</button>
    </div>
  </article>;
}

function StorageView({ state, loading, onClearHistory, onClearCache }: {
  state: DashboardState; loading: boolean; onClearHistory(): void; onClearCache(): void;
}) {
  const summary = state.summary;
  return <section className="storage-view settings-panel">
    <header className="panel-header"><p className="eyebrow">Local library</p><h1>存储与隐私</h1>
      <p>历史、解析结果和译文都保存在扩展本地。API Key 与 Token 不会进入历史记录。</p></header>
    <div className="storage-tally" aria-busy={loading}>
      <div><strong>{summary.history}</strong><span>历史记录</span></div>
      <div><strong>{summary.documents}</strong><span>PDF 文档</span></div>
      <div><strong>{summary.translations}</strong><span>逐页译文</span></div>
      <div><strong>{summary.tasks}</strong><span>解析任务</span></div>
    </div>
    <div className="danger-list">
      <div><div><h2>清空翻译历史</h2><p>删除列表记录，不影响已经缓存的 PDF 解析和译文。</p></div>
        <button type="button" onClick={() => confirmAction('清空全部翻译历史？', onClearHistory)}>清空历史</button></div>
      <div><div><h2>清空 PDF 运行缓存</h2><p>删除解析结果、逐页译文和任务状态；历史列表仍会保留。</p></div>
        <button className="danger" type="button" onClick={() => confirmAction('清空全部 PDF 运行缓存？之后重新阅读需要再次解析和翻译。', onClearCache)}>清空缓存</button></div>
    </div>
  </section>;
}

export function filterHistoryEntries(entries: HistoryEntry[], query: string, filter: HistoryFilter): HistoryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (filter === 'all' || entry.kind === filter) &&
    (!needle || `${entry.title} ${entry.url}`.toLocaleLowerCase().includes(needle)));
}

function initialDashboardSection(): DashboardSection {
  if (typeof location === 'undefined') return 'history';
  const candidate = location.hash.replace(/^#/, '');
  return navigation.some(({ id }) => id === candidate) ? candidate as DashboardSection : 'history';
}

async function runDashboardAction(message: DashboardMessage): Promise<DashboardState | { opened: true }> {
  const response = await browser.runtime.sendMessage(message) as DashboardResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? '后台未返回有效响应');
  return response.value;
}

function hostLabel(rawUrl: string): string { try { return new URL(rawUrl).hostname; } catch { return rawUrl; } }
function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(timestamp);
}
function confirmAction(message: string, action: () => void) { if (globalThis.confirm(message)) action(); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
