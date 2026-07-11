import React from 'react';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { PageScheduler } from '../translation/page-scheduler';
import type { PdfMessage, PdfMessageResponse, PdfSourceTransfer } from './messages';
import { PdfViewer } from './PdfViewer';
import { SyncController, type PdfPane } from './sync-controller';
import { TranslationPane, type TranslationPageStatus } from './TranslationPane';
import { initialLifecycleState, lifecycleReducer } from './workspace-reducer';

export function PdfWorkspace({ sourceUrl }: { sourceUrl: string }) {
  const [lifecycle, dispatch] = React.useReducer(lifecycleReducer, initialLifecycleState);
  const [source, setSource] = React.useState<PdfSourceTransfer | null>(null);
  const [model, setModel] = React.useState<DocumentModel | null>(null);
  const [translations, setTranslations] = React.useState(new Map<string, TranslationResult>());
  const [pageStatus, setPageStatus] = React.useState(new Map<number, TranslationPageStatus>());
  const [activePage, setActivePage] = React.useState(1);
  const [scale, setScale] = React.useState(1.1);
  const [feedback, setFeedback] = React.useState('正在读取 PDF 字节');
  const leftRef = React.useRef<HTMLDivElement>(null);
  const rightRef = React.useRef<HTMLDivElement>(null);
  const schedulerRef = React.useRef<PageScheduler | null>(null);
  const pumpRef = React.useRef<() => void>(() => undefined);
  const parseStarted = React.useRef(false);
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

  const onDocumentReady = React.useCallback((pageCount: number) => {
    if (!source || parseStarted.current) return;
    parseStarted.current = true;
    dispatch({ type: 'source-loaded', sourceKind: source.kind });
    if (source.kind === 'authenticated') {
      setFeedback('此 PDF 需要认证；第三方上传同意将在后续批次提供，左栏仍可阅读');
      return;
    }
    setFeedback('MinerU 正在解析，左栏可继续阅读');
    void sendPdfMessage({
      type: 'pdf:parse-start',
      source,
      pageCount,
      consent: false,
    }).then((value) => {
      if (!isDocument(value)) throw new Error('PDF_DOCUMENT_INVALID');
      setModel(value);
      dispatch({ type: 'parse-done' });
      setFeedback('解析完成，正在按当前页优先翻译');
    }, () => {
      dispatch({ type: 'parse-failed', error: 'MINERU_PARSE_FAILED' });
      setFeedback('MinerU 解析失败；左栏不受影响');
    });
  }, [source]);

  React.useEffect(() => {
    if (!model) return;
    const scheduler = new PageScheduler(model.pageCount, 2);
    scheduler.setActivePage(activePage);
    schedulerRef.current = scheduler;
    let disposed = false;

    const pump = () => {
      if (disposed) return;
      let page: number | null;
      while ((page = scheduler.take()) !== null) {
        const current = page;
        setPageStatus((statuses) => new Map(statuses).set(current, 'translating'));
        void sendPdfMessage({ type: 'pdf:translate-page', hash: model.hash, page: current }).then((value) => {
          if (disposed || !isTranslations(value)) return;
          setTranslations((existing) => {
            const next = new Map(existing);
            for (const translation of value) next.set(translation.id, translation);
            return next;
          });
          setPageStatus((statuses) => new Map(statuses).set(current, 'done'));
          scheduler.markDone(current);
          pump();
        }, () => {
          if (disposed) return;
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

  React.useEffect(() => {
    schedulerRef.current?.setActivePage(activePage);
    pumpRef.current();
  }, [activePage]);

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
    await sendPdfMessage({ type: 'pdf:cache-clear', hash: source.hash });
    setModel(null);
    setTranslations(new Map());
    setPageStatus(new Map());
    dispatch({ type: 'cache-cleared' });
    setFeedback('缓存已清除');
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
        <button type="button" onClick={() => void clearCache()}>清理本文缓存</button>
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>设置</button>
        <button type="button" onClick={() => void browser.runtime.sendMessage({ type: 'pdf-workspace:disable' })}>关闭工作台</button>
      </header>
      <p className="workspace-status" aria-live="polite" data-phase={lifecycle.phase}>{feedback}</p>
      <div className="workspace-columns">
        <section ref={leftRef} className="pdf-column" onScroll={() => syncRef.current?.userScroll('pdf')}>
          {source && pdfBytes
            ? <PdfViewer bytes={pdfBytes} scale={scale} activePage={activePage} onDocumentReady={onDocumentReady} onPageVisible={(page, progress) => visibleFrom('pdf', page, progress)} />
            : <p role="status">正在读取 PDF…</p>}
        </section>
        <section ref={rightRef} className="translation-column" onScroll={() => syncRef.current?.userScroll('translation')}>
          {model
            ? <TranslationPane model={model} translations={translations} pageStatus={pageStatus} onPageVisible={(page, progress) => visibleFrom('translation', page, progress)} />
            : <p role="status">等待 MinerU 解析；PDF 左栏可独立阅读。</p>}
        </section>
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
