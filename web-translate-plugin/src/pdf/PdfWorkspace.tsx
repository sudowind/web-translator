import React from 'react';

import { AgentPanel } from '../agent/AgentPanel';
import type { AgentMessage } from '../agent/context-builder';
import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { PageScheduler } from '../translation/page-scheduler';
import type { PdfMessage, PdfMessageResponse, PdfSourceTransfer } from './messages';
import { OperationEpoch } from './operation-epoch';
import { PdfViewer } from './PdfViewer';
import { initialPageFromUrl } from './source-page';
import { SyncController, type PdfPane } from './sync-controller';
import { TranslationPane, type TranslationPageStatus } from './TranslationPane';
import { initialLifecycleState, lifecycleReducer } from './workspace-reducer';

export function PdfWorkspace({ sourceUrl }: { sourceUrl: string }) {
  const [lifecycle, dispatch] = React.useReducer(lifecycleReducer, initialLifecycleState);
  const [source, setSource] = React.useState<PdfSourceTransfer | null>(null);
  const [model, setModel] = React.useState<DocumentModel | null>(null);
  const [translations, setTranslations] = React.useState(new Map<string, TranslationResult>());
  const [pageStatus, setPageStatus] = React.useState(new Map<number, TranslationPageStatus>());
  const [activePage, setActivePage] = React.useState(() => initialPageFromUrl(sourceUrl));
  const [scale, setScale] = React.useState(1.1);
  const [feedback, setFeedback] = React.useState('正在读取 PDF 字节');
  const [documentPageCount, setDocumentPageCount] = React.useState(0);
  const [agentOpen, setAgentOpen] = React.useState(true);
  const [agentMessages, setAgentMessages] = React.useState<AgentMessage[]>([]);
  const [agentBusy, setAgentBusy] = React.useState(false);
  const [agentNotice, setAgentNotice] = React.useState<string>();
  const [agentError, setAgentError] = React.useState<string>();
  const leftRef = React.useRef<HTMLDivElement>(null);
  const rightRef = React.useRef<HTMLDivElement>(null);
  const schedulerRef = React.useRef<PageScheduler | null>(null);
  const pumpRef = React.useRef<() => void>(() => undefined);
  const parseStarted = React.useRef(false);
  const operationEpoch = React.useRef(new OperationEpoch());
  const syncRef = React.useRef<SyncController | null>(null);
  const pdfBytes = React.useMemo(
    () => source ? Uint8Array.from(source.bytes) : null,
    [source],
  );

  if (!syncRef.current) {
    syncRef.current = new SyncController((pane, page, progress) => {
      const container = pane === 'pdf' ? leftRef.current : rightRef.current;
      const selector = pane === 'pdf'
        ? `[data-pdf-page="${page}"]`
        : `[data-translation-page="${page}"]`;
      const anchor = container?.querySelector<HTMLElement>(selector);
      const scroller = container?.firstElementChild as HTMLElement | null;
      if (anchor && scroller) {
        scroller.scrollTop = anchor.offsetTop + anchor.offsetHeight * progress;
      }
      globalThis.setTimeout(() => syncRef.current?.release(pane), 0);
    });
  }

  React.useEffect(() => {
    dispatch({ type: 'load-started' });
    let cancelled = false;
    void sendPdfMessage({ type: 'pdf:source', url: sourceUrl }).then((value) => {
      if (cancelled || !isSource(value)) return;
      setSource(value);
      setFeedback('PDF.js 正在准备页面；左栏无需等待解析');
    }, () => {
      if (!cancelled) {
        dispatch({ type: 'parse-failed', error: 'PDF_SOURCE_FAILED' });
        setFeedback('PDF 字节读取失败');
      }
    });
    return () => {
      cancelled = true;
      void sendPdfMessage({ type: 'pdf:cancel' }).catch(() => undefined);
    };
  }, [sourceUrl]);

  const startParse = React.useCallback((pageCount: number, consent: boolean) => {
    if (!source || parseStarted.current) return;
    parseStarted.current = true;
    const epoch = operationEpoch.current.current();
    dispatch({ type: consent ? 'consent-granted' : 'parse-started' });
    setFeedback('MinerU 正在解析，左栏可继续阅读');
    void sendPdfMessage({
      type: 'pdf:parse-start',
      source,
      pageCount,
      consent,
    }).then((value) => {
      if (!operationEpoch.current.isCurrent(epoch)) return;
      if (!isDocument(value)) throw new Error('PDF_DOCUMENT_INVALID');
      setModel(value);
      dispatch({ type: 'parse-done' });
      setFeedback('解析完成，正在按当前页优先翻译');
    }, () => {
      if (!operationEpoch.current.isCurrent(epoch)) return;
      parseStarted.current = false;
      dispatch({ type: 'parse-failed', error: 'MINERU_PARSE_FAILED' });
      setFeedback('MinerU 解析失败；左栏不受影响');
    });
  }, [source]);

  const onDocumentReady = React.useCallback((pageCount: number) => {
    if (!source) return;
    setDocumentPageCount(pageCount);
    dispatch({ type: 'source-loaded', sourceKind: source.kind });
    if (source.kind === 'authenticated') {
      setFeedback('需要明确同意后才能把此 PDF 上传到 MinerU；左栏仍可阅读');
      return;
    }
    startParse(pageCount, false);
  }, [source, startParse]);

  React.useEffect(() => {
    if (!model) return;
    const scheduler = new PageScheduler(model.pageCount, 2);
    const epoch = operationEpoch.current.current();
    schedulerRef.current = scheduler;
    let disposed = false;

    const pump = () => {
      if (disposed) return;
      let page: number | null;
      while ((page = scheduler.take()) !== null) {
        const current = page;
        setPageStatus((statuses) => new Map(statuses).set(current, 'translating'));
        void sendPdfMessage({ type: 'pdf:translate-page', hash: model.hash, page: current }).then((value) => {
          if (disposed || !operationEpoch.current.isCurrent(epoch) || !isTranslations(value)) return;
          setTranslations((existing) => {
            const next = new Map(existing);
            for (const translation of value) next.set(translation.id, translation);
            return next;
          });
          setPageStatus((statuses) => new Map(statuses).set(current, 'done'));
          scheduler.markDone(current);
          pump();
        }, () => {
          if (disposed || !operationEpoch.current.isCurrent(epoch)) return;
          setPageStatus((statuses) => new Map(statuses).set(current, 'failed'));
          scheduler.markFailed(current);
          pump();
        });
      }
    };
    pumpRef.current = pump;
    pump();
    return () => {
      disposed = true;
      schedulerRef.current = null;
      pumpRef.current = () => undefined;
    };
  }, [model]);

  const visibleFrom = React.useCallback((pane: PdfPane, page: number, progress: number) => {
    setActivePage(page);
    syncRef.current?.onVisible(pane, page, progress);
  }, []);

  function retryCurrent() {
    schedulerRef.current?.retry(activePage);
    setPageStatus((statuses) => new Map(statuses).set(activePage, 'retrying'));
    pumpRef.current();
  }

  function retryFailed() {
    for (const [page, status] of pageStatus) {
      if (status === 'failed') schedulerRef.current?.retry(page);
    }
    pumpRef.current();
  }

  async function clearCache() {
    if (!source) return;
    operationEpoch.current.advance();
    await sendPdfMessage({ type: 'pdf:cache-clear', hash: source.hash });
    setModel(null);
    setTranslations(new Map());
    setPageStatus(new Map());
    parseStarted.current = false;
    dispatch({ type: 'cache-cleared' });
    setFeedback('缓存已清除');
  }

  async function askAgent(question: string) {
    if (!model) return;
    const user: AgentMessage = { role: 'user', content: question };
    const recentMessages = [...agentMessages, user].slice(-12);
    setAgentMessages(recentMessages);
    setAgentBusy(true);
    setAgentError(undefined);
    try {
      const value = await sendPdfMessage({
        type: 'pdf:agent-ask',
        hash: model.hash,
        activePage,
        selection: globalThis.getSelection?.()?.toString() ?? '',
        recentMessages: agentMessages.slice(-10),
        question,
        maxCharacters: 60_000,
      });
      if (!isAgentAnswer(value)) throw new Error('AGENT_RESPONSE_INVALID');
      setAgentNotice(value.notice);
      setAgentMessages((messages) => [...messages, { role: 'assistant', content: value.answer }]);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'AGENT_FAILED');
    } finally {
      setAgentBusy(false);
    }
  }

  function stopAgent() {
    void sendPdfMessage({ type: 'pdf:agent-cancel' }).catch(() => undefined);
    setAgentBusy(false);
    setAgentError('已停止当前请求');
  }

  return (
    <main className="pdf-workspace" data-renderer="pdfjs">
      <header className="workspace-toolbar">
        <strong>{source?.title ?? 'PDF 翻译工作台'}</strong>
        <span>第 {activePage} 页</span>
        <button type="button" onClick={() => setScale((value) => Math.max(0.5, value - 0.1))}>缩小</button>
        <button type="button" onClick={() => setScale((value) => Math.min(3, value + 0.1))}>放大</button>
        <button type="button" onClick={retryCurrent}>重试当前页</button>
        <button type="button" onClick={retryFailed}>重试失败页</button>
        {lifecycle.phase === 'failed' && source?.kind === 'remote' && <button type="button" onClick={() => startParse(documentPageCount, false)}>重试解析</button>}
        <button type="button" onClick={stopAgent}>取消当前任务</button>
        <button type="button" onClick={() => void clearCache()}>清理本文缓存</button>
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>设置</button>
        <button type="button" onClick={() => void browser.runtime.sendMessage({ type: 'pdf-workspace:disable' })}>关闭工作台</button>
      </header>
      <p className="workspace-status" aria-live="polite" data-phase={lifecycle.phase}>{feedback}</p>
      <div className={`workspace-columns ${agentOpen ? 'agent-open' : 'agent-collapsed'}`}>
        <section ref={leftRef} className="pdf-column" onScroll={() => syncRef.current?.userScroll('pdf')}>
          {source && pdfBytes
            ? <PdfViewer bytes={pdfBytes} scale={scale} activePage={activePage} onDocumentReady={onDocumentReady} onPageVisible={(page, progress) => visibleFrom('pdf', page, progress)} />
            : <p role="status">正在读取 PDF…</p>}
        </section>
        <section ref={rightRef} className="translation-column" onScroll={() => syncRef.current?.userScroll('translation')}>
          {model
            ? <TranslationPane model={model} translations={translations} pageStatus={pageStatus} onPageVisible={(page, progress) => visibleFrom('translation', page, progress)} />
            : source?.kind === 'authenticated' ? <div className="upload-consent" role="region" aria-label="MinerU 上传同意">
              <h2>确认发送到第三方解析服务</h2>
              <dl><dt>目标服务</dt><dd>MinerU</dd><dt>文件名</dt><dd>{source.title}</dd><dt>大小</dt><dd>{formatBytes(source.size)}</dd></dl>
              <p>此 PDF 需要认证。点击同意后，文件字节将发送到第三方 MinerU 解析服务。</p>
              <button type="button" disabled={documentPageCount < 1} onClick={() => startParse(documentPageCount, true)}>同意并上传到 MinerU</button>
            </div> : <p role="status">等待 MinerU 解析；PDF 左栏可独立阅读。</p>}
        </section>
        <AgentPanel
          open={agentOpen}
          pageCount={model?.pageCount ?? documentPageCount}
          notice={agentNotice}
          messages={agentMessages}
          busy={agentBusy}
          error={agentError}
          onAsk={askAgent}
          onStop={stopAgent}
          onNavigate={(page) => { setActivePage(page); syncRef.current?.navigateToPage(page); }}
          onToggle={() => setAgentOpen((open) => !open)}
        />
      </div>
    </main>
  );
}

async function sendPdfMessage(message: PdfMessage) {
  const response = await browser.runtime.sendMessage(message) as PdfMessageResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'PDF_BACKGROUND_FAILED');
  return response.value;
}

function isSource(value: unknown): value is PdfSourceTransfer {
  return typeof value === 'object' && value !== null && 'bytes' in value && Array.isArray((value as PdfSourceTransfer).bytes);
}

function isDocument(value: unknown): value is DocumentModel {
  return typeof value === 'object' && value !== null && 'pages' in value && Array.isArray((value as DocumentModel).pages);
}

function isTranslations(value: unknown): value is TranslationResult[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item && 'text' in item);
}

function isAgentAnswer(value: unknown): value is { answer: string; mode: 'full' | 'compressed'; notice?: string } {
  return typeof value === 'object' && value !== null && 'answer' in value && typeof (value as { answer?: unknown }).answer === 'string';
}

function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
