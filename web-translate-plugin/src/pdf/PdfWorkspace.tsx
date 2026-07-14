import React from 'react';

import { AgentPanel } from '../agent/AgentPanel';
import type { AgentMessage } from '../agent/context-builder';
import { appendAgentDelta, failAgentAnswer, finalizeAgentAnswer, stopAgentAnswer } from '../agent/stream-state';
import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { classifyTranslationFailure, formatTranslationFailure, type TranslationFailure } from '../translation/failure';
import { PageScheduler } from '../translation/page-scheduler';
import { isPdfAgentProgress, isPdfTranslationProgress, type PdfMessage, type PdfMessageResponse, type PdfSourceTransfer } from './messages';
import { OperationEpoch } from './operation-epoch';
import { PairedPageViewer } from './PairedPageViewer';
import { initialPageFromUrl } from './source-page';
import type { TranslationPageStatus } from './TranslationPane';
import { WorkspaceToolbar, workspaceFeedbackPlacement } from './WorkspaceToolbar';
import { initialLifecycleState, lifecycleReducer } from './workspace-reducer';

export function PdfWorkspace({ sourceUrl }: { sourceUrl: string }) {
  const [lifecycle, dispatch] = React.useReducer(lifecycleReducer, initialLifecycleState);
  const [source, setSource] = React.useState<PdfSourceTransfer | null>(null);
  const [model, setModel] = React.useState<DocumentModel | null>(null);
  const [translations, setTranslations] = React.useState(new Map<string, TranslationResult>());
  const [pageStatus, setPageStatus] = React.useState(new Map<number, TranslationPageStatus>());
  const [pageFailures, setPageFailures] = React.useState(new Map<number, TranslationFailure>());
  const [pageAttempts, setPageAttempts] = React.useState(new Map<number, number>());
  const [activePage, setActivePage] = React.useState(() => initialPageFromUrl(sourceUrl));
  const [navigationPage, setNavigationPage] = React.useState(() => initialPageFromUrl(sourceUrl));
  const [scale, setScale] = React.useState(1.1);
  const [feedback, setFeedback] = React.useState('正在读取 PDF 字节');
  const [documentPageCount, setDocumentPageCount] = React.useState(0);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [agentMessages, setAgentMessages] = React.useState<AgentMessage[]>([]);
  const [agentBusy, setAgentBusy] = React.useState(false);
  const [agentNotice, setAgentNotice] = React.useState<string>();
  const [agentError, setAgentError] = React.useState<string>();
  const [previewBlockId, setPreviewBlockId] = React.useState<string | null>(null);
  const [pinnedBlockId, setPinnedBlockId] = React.useState<string | null>(null);
  const schedulerRef = React.useRef<PageScheduler | null>(null);
  const pumpRef = React.useRef<() => void>(() => undefined);
  const parseStarted = React.useRef(false);
  const operationEpoch = React.useRef(new OperationEpoch());
  const activeAgentRequestId = React.useRef<string | null>(null);
  const pendingAgentDelta = React.useRef('');
  const agentFlushTimer = React.useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);
  const pdfBytes = React.useMemo(
    () => source ? Uint8Array.from(source.bytes) : null,
    [source],
  );
  const highlightedBlockId = previewBlockId ?? pinnedBlockId;
  const pageCount = model?.pageCount ?? documentPageCount;
  const feedbackPlacement = workspaceFeedbackPlacement(lifecycle.phase);
  const hasFailedPages = Array.from(pageStatus.values()).some((status) => status === 'failed');

  React.useEffect(() => {
    setPreviewBlockId(null);
    setPinnedBlockId(null);
  }, [model?.hash]);

  const flushAgentDeltas = React.useCallback(() => {
    if (agentFlushTimer.current !== undefined) {
      globalThis.clearTimeout(agentFlushTimer.current);
      agentFlushTimer.current = undefined;
    }
    const requestId = activeAgentRequestId.current;
    const delta = pendingAgentDelta.current;
    pendingAgentDelta.current = '';
    if (!requestId || !delta) return;
    setAgentMessages((messages) => appendAgentDelta(messages, requestId, delta));
  }, []);

  React.useEffect(() => {
    if (!model) return;
    const listener = (message: unknown) => {
      if (isPdfTranslationProgress(message) && message.hash === model.hash) {
        setPageAttempts((attempts) => new Map(attempts).set(message.page, message.attempt));
        return;
      }
      if (!isPdfAgentProgress(message) || message.hash !== model.hash ||
        message.requestId !== activeAgentRequestId.current) return;
      pendingAgentDelta.current += message.delta;
      if (agentFlushTimer.current === undefined) {
        agentFlushTimer.current = globalThis.setTimeout(flushAgentDeltas, 50);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [flushAgentDeltas, model]);

  React.useEffect(() => () => {
    if (agentFlushTimer.current !== undefined) globalThis.clearTimeout(agentFlushTimer.current);
  }, []);

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
      setFeedback('解析完成，正在从第 1 页开始翻译');
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
        setPageFailures((failures) => withoutPage(failures, current));
        setPageStatus((statuses) => new Map(statuses).set(current, 'translating'));
        void sendPdfMessage({ type: 'pdf:translate-page', hash: model.hash, page: current }).then((value) => {
          if (disposed || !operationEpoch.current.isCurrent(epoch) || !isTranslations(value)) return;
          setTranslations((existing) => {
            const next = new Map(existing);
            for (const translation of value) next.set(translation.id, translation);
            return next;
          });
          setPageStatus((statuses) => new Map(statuses).set(current, 'done'));
          setPageAttempts((attempts) => withoutPage(attempts, current));
          setPageFailures((failures) => withoutPage(failures, current));
          scheduler.markDone(current);
          pump();
        }, (error: unknown) => {
          if (disposed || !operationEpoch.current.isCurrent(epoch)) return;
          setPageStatus((statuses) => new Map(statuses).set(current, 'failed'));
          setPageAttempts((attempts) => withoutPage(attempts, current));
          const failure = error instanceof PdfMessageError && error.failure
            ? error.failure
            : classifyTranslationFailure(error, { attempts: 1, durationMs: 0, model: 'unknown' });
          setPageFailures((failures) => new Map(failures).set(current, failure));
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

  React.useEffect(() => {
    if (!model) return;
    let done = 0;
    let translating = 0;
    let failed = 0;
    for (let page = 1; page <= model.pageCount; page += 1) {
      const status = pageStatus.get(page);
      if (status === 'done') done += 1;
      else if (status === 'translating' || status === 'retrying') translating += 1;
      else if (status === 'failed') failed += 1;
    }
    setFeedback(`已完成 ${done}/${model.pageCount} 页 · 翻译中 ${translating} 页 · 失败 ${failed} 页`);
  }, [model, pageStatus]);

  const onPageVisible = React.useCallback((page: number) => {
    setActivePage(page);
  }, []);

  const navigateToPage = React.useCallback((page: number) => {
    const pageCount = model?.pageCount ?? documentPageCount;
    if (pageCount < 1) return;
    const target = Math.min(Math.max(page, 1), pageCount);
    setActivePage(target);
    setNavigationPage(target);
  }, [documentPageCount, model?.pageCount]);

  function retryCurrent() {
    retryPage(activePage);
  }

  function retryPage(page: number) {
    if (schedulerRef.current?.retry(page) !== true) return;
    setPageFailures((failures) => withoutPage(failures, page));
    setPageStatus((statuses) => new Map(statuses).set(page, 'retrying'));
    pumpRef.current();
  }

  function retryFailed() {
    const retried: number[] = [];
    for (const [page, status] of pageStatus) {
      if (status === 'failed' && schedulerRef.current?.retry(page) === true) retried.push(page);
    }
    if (retried.length > 0) {
      setPageFailures((failures) => {
        const next = new Map(failures);
        for (const page of retried) next.delete(page);
        return next;
      });
      setPageStatus((statuses) => {
        const next = new Map(statuses);
        for (const page of retried) next.set(page, 'retrying');
        return next;
      });
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
    setPageFailures(new Map());
    setPageAttempts(new Map());
    parseStarted.current = false;
    dispatch({ type: 'cache-cleared' });
    setFeedback('缓存已清除');
  }

  async function askAgent(question: string) {
    if (!model) return;
    const previousRequestId = activeAgentRequestId.current;
    if (previousRequestId) {
      flushAgentDeltas();
      setAgentMessages((messages) => stopAgentAnswer(messages, previousRequestId));
    }
    const requestId = globalThis.crypto.randomUUID();
    activeAgentRequestId.current = requestId;
    pendingAgentDelta.current = '';
    const user: AgentMessage = { role: 'user', content: question };
    const assistant: AgentMessage = { role: 'assistant', content: '', requestId, status: 'streaming' };
    const recentMessages = agentMessages
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content }))
      .slice(-10);
    setAgentMessages((messages) => [...messages, user, assistant].slice(-12));
    setAgentBusy(true);
    setAgentError(undefined);
    try {
      const value = await sendPdfMessage({
        type: 'pdf:agent-ask',
        hash: model.hash,
        requestId,
        activePage,
        selection: globalThis.getSelection?.()?.toString() ?? '',
        recentMessages,
        question,
        maxCharacters: 60_000,
      });
      if (activeAgentRequestId.current !== requestId) return;
      if (!isAgentAnswer(value)) throw new Error('AGENT_RESPONSE_INVALID');
      flushAgentDeltas();
      setAgentNotice(value.notice);
      setAgentMessages((messages) => finalizeAgentAnswer(messages, requestId, value.answer));
    } catch (error) {
      if (activeAgentRequestId.current !== requestId) return;
      flushAgentDeltas();
      setAgentMessages((messages) => failAgentAnswer(messages, requestId));
      setAgentError(error instanceof Error ? error.message : 'AGENT_FAILED');
    } finally {
      if (activeAgentRequestId.current === requestId) {
        activeAgentRequestId.current = null;
        setAgentBusy(false);
      }
    }
  }

  function stopAgent() {
    const requestId = activeAgentRequestId.current;
    flushAgentDeltas();
    if (requestId) setAgentMessages((messages) => stopAgentAnswer(messages, requestId));
    activeAgentRequestId.current = null;
    void sendPdfMessage({ type: 'pdf:agent-cancel' }).catch(() => undefined);
    setAgentBusy(false);
    setAgentError('已停止当前请求');
  }

  return (
    <main className="pdf-workspace" data-renderer="pdfjs" data-pdf-render-page={activePage}>
      <WorkspaceToolbar
        title={source?.title ?? 'PDF 翻译工作台'}
        activePage={activePage}
        pageCount={pageCount}
        progressLabel={feedback}
        agentOpen={agentOpen}
        canRetryFailed={hasFailedPages}
        canStopAgent={agentBusy}
        onZoomOut={() => setScale((value) => Math.max(0.5, value - 0.1))}
        onZoomIn={() => setScale((value) => Math.min(3, value + 0.1))}
        onToggleAgent={() => setAgentOpen((open) => !open)}
        onRetryCurrent={retryCurrent}
        onRetryFailed={retryFailed}
        onRetryParsing={lifecycle.phase === 'failed' && source?.kind === 'remote'
          ? () => startParse(documentPageCount, false)
          : undefined}
        onStopAgent={stopAgent}
        onClearCache={() => void clearCache()}
        onOpenSettings={() => void browser.runtime.openOptionsPage()}
        onCloseWorkspace={() => void browser.runtime.sendMessage({ type: 'pdf-workspace:disable' })}
      />
      {feedbackPlacement === 'notice' &&
        <p className="workspace-status" aria-live="polite" data-phase={lifecycle.phase}>{feedback}</p>}
      <div className={`workspace-content ${agentOpen ? 'agent-open' : 'agent-closed'}`}>
        <section className="reading-stream">
          {!model && source?.kind === 'authenticated' && <div className="upload-consent" role="region" aria-label="MinerU 上传同意">
              <h2>确认发送到第三方解析服务</h2>
              <dl><dt>目标服务</dt><dd>MinerU</dd><dt>文件名</dt><dd>{source.title}</dd><dt>大小</dt><dd>{formatBytes(source.size)}</dd></dl>
              <p>此 PDF 需要认证。点击同意后，文件字节将发送到第三方 MinerU 解析服务。</p>
              <button type="button" disabled={documentPageCount < 1} onClick={() => startParse(documentPageCount, true)}>同意并上传到 MinerU</button>
            </div>}
          {source && pdfBytes
            ? <PairedPageViewer
              bytes={pdfBytes}
              scale={scale}
              activePage={activePage}
              navigationPage={navigationPage}
              model={model}
              translations={translations}
              pageStatus={pageStatus}
              pageFailures={pageFailures}
              pageAttempts={pageAttempts}
              highlightedBlockId={highlightedBlockId}
              pinnedBlockId={pinnedBlockId}
              onDocumentReady={onDocumentReady}
              onPageVisible={onPageVisible}
              onRetryPage={retryPage}
              onCopyFailure={(failure) => void navigator.clipboard.writeText(formatTranslationFailure(failure))}
              onBlockPreview={setPreviewBlockId}
              onBlockPin={(blockId) => setPinnedBlockId((current) => current === blockId ? null : blockId)}
            />
            : <p role="status">正在读取 PDF…</p>}
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
          onNavigate={navigateToPage}
          onToggle={() => setAgentOpen((open) => !open)}
        />
      </div>
    </main>
  );
}

async function sendPdfMessage(message: PdfMessage) {
  const response = await browser.runtime.sendMessage(message) as PdfMessageResponse | undefined;
  if (!response?.ok) throw new PdfMessageError(response?.error ?? 'PDF_BACKGROUND_FAILED', response?.failure);
  return response.value;
}

class PdfMessageError extends Error {
  constructor(message: string, readonly failure?: TranslationFailure) {
    super(message);
    this.name = 'PdfMessageError';
  }
}

function withoutPage<T>(values: ReadonlyMap<number, T>, page: number): Map<number, T> {
  if (!values.has(page)) return values instanceof Map ? values : new Map(values);
  const next = new Map(values);
  next.delete(page);
  return next;
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
