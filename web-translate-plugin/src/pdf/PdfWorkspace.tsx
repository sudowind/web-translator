import React from 'react';

import { AgentPanel } from '../agent/AgentPanel';
import type { AgentMessage } from '../agent/context-builder';
import { appendAgentDelta, failAgentAnswer, finalizeAgentAnswer, stopAgentAnswer } from '../agent/stream-state';
import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { defaultTranslationMode } from '../translation/document-policy';
import { classifyTranslationFailure, formatTranslationFailure, type TranslationFailure } from '../translation/failure';
import { PAGE_PRIORITY, PageScheduler, type ReadingDirection, type TranslationMode } from '../translation/page-scheduler';
import {
  isPdfAgentProgress,
  isPdfTranslationProgress,
  type PdfMessage,
  type PdfMessageResponse,
  type PdfSourceDescriptor,
  type PdfTranslationSnapshot,
} from './messages';
import { OperationEpoch } from './operation-epoch';
import { PairedPageViewer } from './PairedPageViewer';
import { loadPdfSource } from './pdf-source';
import { initialPageFromUrl } from './source-page';
import type { TranslationPageStatus } from './TranslationPane';
import { WorkspaceToolbar, workspaceFeedbackPlacement } from './WorkspaceToolbar';
import { initialLifecycleState, lifecycleReducer } from './workspace-reducer';

export function PdfWorkspace({ sourceUrl }: { sourceUrl: string }) {
  const [lifecycle, dispatch] = React.useReducer(lifecycleReducer, initialLifecycleState);
  const [source, setSource] = React.useState<PdfSourceDescriptor | null>(null);
  const [pdfBytes, setPdfBytes] = React.useState<Uint8Array | null>(null);
  const [model, setModel] = React.useState<DocumentModel | null>(null);
  const [translationsByPage, setTranslationsByPage] = React.useState(
    new Map<number, ReadonlyMap<string, TranslationResult>>(),
  );
  const [pageStatus, setPageStatus] = React.useState(new Map<number, TranslationPageStatus>());
  const [pageFailures, setPageFailures] = React.useState(new Map<number, TranslationFailure>());
  const [pageAttempts, setPageAttempts] = React.useState(new Map<number, number>());
  const [activePage, setActivePage] = React.useState(() => initialPageFromUrl(sourceUrl));
  const [navigationPage, setNavigationPage] = React.useState(() => initialPageFromUrl(sourceUrl));
  const [scale, setScale] = React.useState(1.1);
  const [translationMode, setTranslationMode] = React.useState<TranslationMode>('full-document');
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
  const activePageRef = React.useRef(activePage);
  const readingDirectionRef = React.useRef<ReadingDirection>(0);
  const snapshotRequestCount = React.useRef(0);
  activePageRef.current = activePage;
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
    setSource(null);
    setPdfBytes(null);
    let cancelled = false;
    const controller = new AbortController();
    void loadPdfSource(sourceUrl, globalThis.fetch, controller.signal).then(({ descriptor, bytes }) => {
      if (cancelled) return;
      setSource(descriptor);
      setPdfBytes(bytes);
      setFeedback('PDF.js 正在准备页面；左栏无需等待解析');
    }).catch(() => {
      if (!cancelled) {
        dispatch({ type: 'parse-failed', error: 'PDF_SOURCE_FAILED' });
        setFeedback('PDF 字节读取失败');
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
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
    }).catch(() => {
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
    const initialMode = defaultTranslationMode(model);
    const scheduler = new PageScheduler(model.pageCount, 2, initialMode);
    const epoch = operationEpoch.current.current();
    schedulerRef.current = scheduler;
    setTranslationMode(initialMode);
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
          setTranslationsByPage((existing) => {
            const next = new Map(existing);
            next.set(current, translationMap(value));
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
    snapshotRequestCount.current += 1;
    void sendPdfMessage({ type: 'pdf:translation-snapshot', hash: model.hash }).then((value) => {
      if (disposed || !operationEpoch.current.isCurrent(epoch) || !isTranslationSnapshot(value)) return;
      const cachedPages = value.pages.map(({ page }) => page);
      scheduler.hydrateDone(cachedPages);
      setTranslationsByPage(new Map(value.pages.map(({ page, blocks }) => [page, translationMap(blocks)])));
      setPageStatus(new Map(cachedPages.map((page) => [page, 'done' as const])));
    }).catch(() => undefined).finally(() => {
      if (disposed || !operationEpoch.current.isCurrent(epoch)) return;
      if (initialMode === 'on-demand') {
        const requested = scheduler.requestWindow(activePageRef.current, readingDirectionRef.current);
        setPageStatus((statuses) => markRequestedPages(statuses, requested));
      }
      pump();
    });
    return () => {
      disposed = true;
      schedulerRef.current = null;
      pumpRef.current = () => undefined;
    };
  }, [model]);

  React.useEffect(() => {
    if (!model || translationMode !== 'on-demand') return;
    const timer = globalThis.setTimeout(() => {
      const scheduler = schedulerRef.current;
      if (!scheduler || scheduler.getMode() !== 'on-demand') return;
      const requested = scheduler.requestWindow(activePage, readingDirectionRef.current);
      setPageStatus((statuses) => markRequestedPages(statuses, requested));
      pumpRef.current();
    }, 350);
    return () => globalThis.clearTimeout(timer);
  }, [activePage, model, translationMode]);

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
    if (translationMode === 'on-demand') {
      const current = pageStatus.get(activePage) ?? 'unrequested';
      const currentLabel = current === 'done' ? '当前页已完成'
        : current === 'failed' ? '当前页失败'
          : current === 'translating' || current === 'retrying' ? '当前页翻译中'
            : '当前页等待翻译';
      setFeedback(`${currentLabel} · 已缓存 ${done}/${model.pageCount} 页 · 正在预取 ${Math.max(0, translating - (current === 'translating' || current === 'retrying' ? 1 : 0))} 页`);
    } else {
      setFeedback(`已完成 ${done}/${model.pageCount} 页 · 翻译中 ${translating} 页 · 失败 ${failed} 页`);
    }
  }, [activePage, model, pageStatus, translationMode]);

  React.useEffect(() => {
    if (!source || pageCount < 1) return;
    const timer = globalThis.setTimeout(() => {
      void sendPdfMessage({
        type: 'pdf:history-update', hash: model?.hash ?? source.hash,
        title: model?.title ?? source.title, page: Math.min(activePage, pageCount), pageCount,
      }).catch(() => undefined);
    }, 350);
    return () => globalThis.clearTimeout(timer);
  }, [activePage, model?.hash, model?.title, pageCount, source]);

  const onPageVisible = React.useCallback((page: number) => {
    const previous = activePageRef.current;
    readingDirectionRef.current = page === previous ? readingDirectionRef.current : page > previous ? 1 : -1;
    activePageRef.current = page;
    setActivePage(page);
  }, []);

  const navigateToPage = React.useCallback((page: number) => {
    const pageCount = model?.pageCount ?? documentPageCount;
    if (pageCount < 1) return;
    const target = Math.min(Math.max(page, 1), pageCount);
    const previous = activePageRef.current;
    readingDirectionRef.current = target === previous ? readingDirectionRef.current : target > previous ? 1 : -1;
    activePageRef.current = target;
    setActivePage(target);
    setNavigationPage(target);
    const scheduler = schedulerRef.current;
    if (scheduler?.getMode() === 'on-demand') {
      const requested = scheduler.requestNavigationWindow(target, readingDirectionRef.current);
      setPageStatus((statuses) => markRequestedPages(statuses, requested));
      pumpRef.current();
    } else if (scheduler) {
      scheduler.requestPage(target, PAGE_PRIORITY.navigation);
      pumpRef.current();
    }
  }, [documentPageCount, model?.pageCount]);

  const requestPage = React.useCallback((page: number) => {
    const scheduler = schedulerRef.current;
    if (!scheduler?.requestPage(page, PAGE_PRIORITY.navigation)) return;
    setPageStatus((statuses) => new Map(statuses).set(page, 'pending'));
    pumpRef.current();
  }, []);

  const retryPage = React.useCallback((page: number) => {
    if (schedulerRef.current?.retry(page) !== true) return;
    setPageFailures((failures) => withoutPage(failures, page));
    setPageStatus((statuses) => new Map(statuses).set(page, 'retrying'));
    pumpRef.current();
  }, []);

  const retryCurrent = React.useCallback(() => {
    if (pageStatus.get(activePage) === 'failed') retryPage(activePage);
    else requestPage(activePage);
  }, [activePage, pageStatus, requestPage, retryPage]);

  const changeTranslationMode = React.useCallback((mode: TranslationMode) => {
    const scheduler = schedulerRef.current;
    if (!scheduler || scheduler.getMode() === mode) return;
    scheduler.setMode(mode);
    setTranslationMode(mode);
    if (mode === 'on-demand') {
      const requested = scheduler.requestWindow(activePageRef.current, readingDirectionRef.current);
      setPageStatus((statuses) => markRequestedPages(statuses, requested));
    }
    pumpRef.current();
  }, []);

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
    setTranslationsByPage(new Map());
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

  const copyFailure = React.useCallback((failure: TranslationFailure) => {
    void navigator.clipboard.writeText(formatTranslationFailure(failure));
  }, []);

  const pinBlock = React.useCallback((blockId: string) => {
    setPinnedBlockId((current) => current === blockId ? null : blockId);
  }, []);

  return (
    <main
      className="pdf-workspace"
      data-renderer="pdfjs"
      data-pdf-render-page={activePage}
      data-translation-snapshot-count={snapshotRequestCount.current}
    >
      <WorkspaceToolbar
        title={source?.title ?? 'PDF 翻译工作台'}
        activePage={activePage}
        pageCount={pageCount}
        scale={scale}
        progressLabel={feedback}
        agentOpen={agentOpen}
        canRetryFailed={hasFailedPages}
        canStopAgent={agentBusy}
        translationMode={translationMode}
        onNavigatePage={navigateToPage}
        onChangeTranslationMode={changeTranslationMode}
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
              <button className="upload-consent-action" type="button" disabled={documentPageCount < 1} onClick={() => startParse(documentPageCount, true)}>同意并上传到 MinerU</button>
            </div>}
          {source && pdfBytes
            ? <PairedPageViewer
              bytes={pdfBytes}
              scale={scale}
              activePage={activePage}
              navigationPage={navigationPage}
              model={model}
              translationsByPage={translationsByPage}
              translationMode={translationMode}
              pageStatus={pageStatus}
              pageFailures={pageFailures}
              pageAttempts={pageAttempts}
              highlightedBlockId={highlightedBlockId}
              pinnedBlockId={pinnedBlockId}
              onDocumentReady={onDocumentReady}
              onPageVisible={onPageVisible}
              onRetryPage={retryPage}
              onRequestPage={requestPage}
              onCopyFailure={copyFailure}
              onBlockPreview={setPreviewBlockId}
              onBlockPin={pinBlock}
            />
            : <div className="pdf-loading-state" role="status">
                <span className="pdf-loading-indicator" aria-hidden="true" />
                <div>
                  <strong>正在读取 PDF</strong>
                  <span>正在准备原文、译文和页面结构…</span>
                </div>
              </div>}
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

function isDocument(value: unknown): value is DocumentModel {
  return typeof value === 'object' && value !== null && 'pages' in value && Array.isArray((value as DocumentModel).pages);
}

function isTranslations(value: unknown): value is TranslationResult[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item && 'text' in item);
}

function isTranslationSnapshot(value: unknown): value is PdfTranslationSnapshot {
  return typeof value === 'object' && value !== null && 'pages' in value &&
    Array.isArray((value as PdfTranslationSnapshot).pages) &&
    (value as PdfTranslationSnapshot).pages.every((entry) => Number.isInteger(entry.page) && isTranslations(entry.blocks));
}

function translationMap(values: TranslationResult[]): ReadonlyMap<string, TranslationResult> {
  return new Map(values.map((translation) => [translation.id, translation]));
}

function markRequestedPages(
  statuses: ReadonlyMap<number, TranslationPageStatus>,
  pages: readonly number[],
): Map<number, TranslationPageStatus> {
  let next: Map<number, TranslationPageStatus> | undefined;
  for (const page of pages) {
    if (statuses.has(page)) continue;
    next ??= new Map(statuses);
    next.set(page, 'pending');
  }
  return next ?? (statuses instanceof Map ? statuses : new Map(statuses));
}

function isAgentAnswer(value: unknown): value is { answer: string; mode: 'full' | 'compressed'; notice?: string } {
  return typeof value === 'object' && value !== null && 'answer' in value && typeof (value as { answer?: unknown }).answer === 'string';
}

function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
