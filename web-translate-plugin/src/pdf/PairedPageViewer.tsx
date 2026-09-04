import React from 'react';
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import type { TranslationFailure } from '../translation/failure';
import type { TranslationMode } from '../translation/page-scheduler';
import { computeReadingLayout, type ReadingLayout } from './page-layout';
import { PdfPageCanvas, visiblePageWindow } from './PdfViewer';
import { TranslationPage, type TranslationPageStatus } from './TranslationPane';
import { selectDominantPage } from './visible-page';

export interface PagePairProps {
  number: number;
  height: number;
  layout: ReadingLayout;
  pdf: React.ReactNode;
  translation: React.ReactNode;
}

export function fitPageHeight(pageWidth: number, pageHeight: number, availableWidth: number): number {
  if (pageWidth <= 0 || pageHeight <= 0 || availableWidth <= 0) return 780;
  return pageHeight * Math.min(1, availableWidth / pageWidth);
}

export function mapsNearlyEqual(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
  epsilon = 0.5,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const candidate = right.get(key);
    if (candidate === undefined || Math.abs(candidate - value) >= epsilon) return false;
  }
  return true;
}

export function PagePair({ number, height, layout, pdf, translation }: PagePairProps) {
  const sectionStyle = {
    '--pdf-page-width': `${layout.pdfWidth}px`,
    '--translation-page-width': `${layout.translationWidth}px`,
    '--page-pair-gutter': `${layout.gutter}px`,
    '--page-pair-width': `${layout.pairWidth}px`,
    width: layout.pairWidth,
    height: layout.mode === 'paired' ? height : undefined,
  } as React.CSSProperties;
  return (
    <section
      className="page-pair"
      data-page-pair={number}
      data-layout={layout.mode}
      data-fitted-to-container={layout.fittedToContainer || undefined}
      aria-label={`第 ${number} 页原文与译文`}
      style={sectionStyle}
    >
      <div className="page-pair-pdf" data-pdf-page={number} style={{ width: layout.pdfWidth, height }}>{pdf}</div>
      <div className="page-pair-translation" style={{ width: layout.translationWidth, height }}>{translation}</div>
    </section>
  );
}

interface PairedPageViewerProps {
  bytes?: Uint8Array;
  url?: string;
  scale: number;
  activePage: number;
  navigationPage: number;
  model: DocumentModel | null;
  translationsByPage: ReadonlyMap<number, ReadonlyMap<string, TranslationResult>>;
  translationMode: TranslationMode;
  pageStatus: ReadonlyMap<number, TranslationPageStatus>;
  pageFailures: ReadonlyMap<number, TranslationFailure>;
  pageAttempts: ReadonlyMap<number, number>;
  highlightedBlockId?: string | null;
  pinnedBlockId?: string | null;
  translationPlaceholder?: React.ReactNode;
  onDocumentReady(pageCount: number): void;
  onPageVisible(page: number, progress: number): void;
  onRetryPage(page: number): void;
  onRequestPage(page: number): void;
  onCopyFailure(failure: TranslationFailure): void;
  onBlockPreview(blockId: string | null): void;
  onBlockPin(blockId: string): void;
}

export function visibleTranslationPageWindow(activePage: number, pageCount: number): Set<number> {
  return visiblePageWindow(activePage, pageCount, 2);
}

export const PairedPageViewer = React.memo(function PairedPageViewer({
  bytes,
  url,
  scale,
  activePage,
  navigationPage,
  model,
  translationsByPage,
  translationMode,
  pageStatus,
  pageFailures,
  pageAttempts,
  highlightedBlockId,
  pinnedBlockId,
  translationPlaceholder,
  onDocumentReady,
  onPageVisible,
  onRetryPage,
  onRequestPage,
  onCopyFailure,
  onBlockPreview,
  onBlockPin,
}: PairedPageViewerProps) {
  const renderStartedAt = performance.now();
  const renderCount = React.useRef(0);
  const maxRenderToCommitMs = React.useRef(0);
  renderCount.current += 1;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const activePageRef = React.useRef(activePage);
  const lastReportedPage = React.useRef<number | null>(null);
  const lastNavigationPage = React.useRef<number | null>(null);
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [pdfPageCount, setPdfPageCount] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [renderScale, setRenderScale] = React.useState(scale);
  const [pageSizes, setPageSizes] = React.useState<ReadonlyMap<number, { width: number; height: number }>>(new Map());
  const [pageHeights, setPageHeights] = React.useState<ReadonlyMap<number, number>>(new Map());
  const translationScrollOffsets = React.useRef(new Map<number, number>());
  const pageSizeCache = React.useRef(new Map<number, { width: number; height: number }>());
  const pageSizeLoads = React.useRef(new Map<number, Promise<{ width: number; height: number }>>());
  const pageProxyCache = React.useRef(new Map<number, PDFPageProxy>());
  const pageLayoutModes = React.useRef(new Map<number, ReadingLayout['mode']>());
  const measuredContainerWidth = React.useRef(0);
  const zoomBurstStartedAt = React.useRef<number | null>(null);
  const pendingReadingAnchor = React.useRef<{ page: number; progress: number } | null>(null);
  activePageRef.current = activePage;

  const captureReadingAnchor = React.useCallback(() => {
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-page-pair="${activePageRef.current}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) return;
    const anchorTop = 68;
    pendingReadingAnchor.current = {
      page: activePageRef.current,
      progress: Math.max(0, Math.min(1, (anchorTop - rect.top) / rect.height)),
    };
  }, []);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const nextWidth = root.clientWidth;
      if (Math.abs(measuredContainerWidth.current - nextWidth) < 0.5) return;
      captureReadingAnchor();
      measuredContainerWidth.current = nextWidth;
      setContainerWidth(nextWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [captureReadingAnchor]);

  React.useEffect(() => {
    if (Math.abs(renderScale - scale) < 0.001) {
      zoomBurstStartedAt.current = null;
      return;
    }
    const now = performance.now();
    zoomBurstStartedAt.current ??= now;
    const maximumRemainingDelay = Math.max(0, 220 - (now - zoomBurstStartedAt.current));
    const timeout = globalThis.setTimeout(() => {
      captureReadingAnchor();
      setRenderScale(scale);
      zoomBurstStartedAt.current = null;
    }, Math.min(120, maximumRemainingDelay));
    return () => globalThis.clearTimeout(timeout);
  }, [captureReadingAnchor, renderScale, scale]);

  React.useLayoutEffect(() => {
    const anchor = pendingReadingAnchor.current;
    if (!anchor || typeof globalThis.scrollBy !== 'function') return;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-page-pair="${anchor.page}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const desiredTop = 68 - anchor.progress * rect.height;
    const delta = rect.top - desiredTop;
    if (Math.abs(delta) >= 0.5) globalThis.scrollBy(0, delta);
    pendingReadingAnchor.current = null;
  }, [containerWidth, renderScale]);

  React.useLayoutEffect(() => {
    const duration = performance.now() - renderStartedAt;
    maxRenderToCommitMs.current = Math.max(maxRenderToCommitMs.current, duration);
    if (rootRef.current) {
      rootRef.current.dataset.readingRenderToCommitMs = duration.toFixed(2);
      rootRef.current.dataset.readingMaxRenderToCommitMs = maxRenderToCommitMs.current.toFixed(2);
    }
  });

  React.useEffect(() => {
    let cancelled = false;
    pageSizeCache.current.clear();
    pageSizeLoads.current.clear();
    pageProxyCache.current.clear();
    pageLayoutModes.current.clear();
    setPageSizes(new Map());
    setPageHeights(new Map());
    setDocument(null);
    setPdfPageCount(0);
    const input = bytes ? { data: bytes } : url ? { url } : null;
    if (!input) return undefined;
    const task = getDocument(input);
    void task.promise.then((pdf) => {
      if (cancelled) return;
      setDocument(pdf);
      setPdfPageCount(pdf.numPages);
      onDocumentReady(pdf.numPages);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, onDocumentReady, url]);

  const pageCount = pdfPageCount || model?.pageCount || 0;

  React.useEffect(() => {
    if (!document || pageCount === 0) return;
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;

    const readSize = (number: number) => {
      const cached = pageSizeCache.current.get(number);
      if (cached) return Promise.resolve(cached);
      const loading = pageSizeLoads.current.get(number);
      if (loading) return loading;
      const promise = document.getPage(number).then((page) => {
        pageProxyCache.current.set(number, page);
        const viewport = page.getViewport({ scale: 1 });
        const size = { width: viewport.width, height: viewport.height };
        pageSizeCache.current.set(number, size);
        return size;
      }).finally(() => pageSizeLoads.current.delete(number));
      pageSizeLoads.current.set(number, promise);
      return promise;
    };
    const publish = async (numbers: number[]) => {
      await Promise.all(numbers.map(readSize));
      if (!cancelled) setPageSizes(new Map(pageSizeCache.current));
    };
    const priorityPages = [...visiblePageWindow(activePage, pageCount)];
    const remaining = Array.from({ length: pageCount }, (_, index) => index + 1)
      .filter((page) => !priorityPages.includes(page));
    const scheduleIdle = () => {
      if (cancelled || remaining.length === 0) return;
      const run = () => {
        const batch = remaining.splice(0, 4).filter((page) => !pageSizeCache.current.has(page));
        void publish(batch).catch(() => undefined).finally(scheduleIdle);
      };
      if (typeof globalThis.requestIdleCallback === 'function') {
        idleHandle = globalThis.requestIdleCallback(run, { timeout: 500 });
      } else {
        timeoutHandle = globalThis.setTimeout(run, 16);
      }
    };
    void publish(priorityPages).catch(() => undefined).finally(scheduleIdle);
    return () => {
      cancelled = true;
      if (idleHandle !== undefined) globalThis.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) globalThis.clearTimeout(timeoutHandle);
    };
  }, [activePage, document, pageCount]);

  const fitAllPageHeights = React.useCallback(() => {
    if (containerWidth <= 0 || pageSizes.size === 0) return;
    const measured = new Map(Array.from(pageSizes, ([number, size]) => [
      number,
      size.height * (computeReadingLayout({
        containerWidth,
        pageWidth: size.width,
        requestedScale: renderScale,
      }).pdfWidth / size.width),
    ]));
    setPageHeights((current) => mapsNearlyEqual(current, measured) ? current : measured);
  }, [containerWidth, pageSizes, renderScale]);

  React.useLayoutEffect(fitAllPageHeights, [fitAllPageHeights]);

  React.useEffect(() => {
    if (!rootRef.current || pageCount === 0) return;
    const visibility = new Map<number, { ratio: number; progress: number }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.pagePair);
        if (!entry.isIntersecting) {
          visibility.delete(page);
          continue;
        }
        const viewportTop = entry.rootBounds?.top ?? 0;
        const height = Math.max(1, entry.boundingClientRect.height);
        visibility.set(page, {
          ratio: entry.intersectionRatio,
          progress: Math.max(0, Math.min(1, (viewportTop - entry.boundingClientRect.top) / height)),
        });
      }
      const page = selectDominantPage(
        Array.from(visibility, ([candidate, value]) => ({ page: candidate, intersectionRatio: value.ratio })),
        lastReportedPage.current ?? activePageRef.current,
      );
      if (page === null || page === lastReportedPage.current) return;
      lastReportedPage.current = page;
      onPageVisible(page, visibility.get(page)?.progress ?? 0);
    }, { root: null, threshold: [0.25, 0.6] });
    rootRef.current.querySelectorAll<HTMLElement>('[data-page-pair]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [onPageVisible, pageCount]);

  React.useLayoutEffect(() => {
    if (!rootRef.current || pageCount === 0 || !pageHeights.has(navigationPage) || lastNavigationPage.current === navigationPage) return;
    const target = rootRef.current.querySelector<HTMLElement>(`[data-page-pair="${navigationPage}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: lastNavigationPage.current === null ? 'auto' : 'smooth' });
    lastNavigationPage.current = navigationPage;
  }, [navigationPage, pageCount, pageHeights]);

  const onHeightChange = React.useCallback((page: number, height: number) => {
    setPageHeights((current) => {
      if (Math.abs((current.get(page) ?? 0) - height) < 0.5) return current;
      const next = new Map(current);
      next.set(page, height);
      return next;
    });
  }, []);

  const renderWindow = visiblePageWindow(activePage, pageCount);
  const translationWindow = visibleTranslationPageWindow(activePage, pageCount);
  const firstKnownSize = pageSizes.values().next().value;
  const pageSizeEstimates = React.useMemo(() => {
    const estimates = new Map<number, { width: number; height: number }>();
    if (firstKnownSize) {
      for (let page = 1; page <= pageCount; page += 1) estimates.set(page, firstKnownSize);
    }
    return estimates;
  }, [firstKnownSize, pageCount]);
  const activePageSize = pageSizes.get(activePage) ?? pageSizeEstimates.get(activePage) ?? { width: 612, height: 792 };
  const activeLayout = computeReadingLayout({
    containerWidth,
    pageWidth: activePageSize.width,
    requestedScale: renderScale,
    previousMode: pageLayoutModes.current.get(activePage),
  });
  pageLayoutModes.current.set(activePage, activeLayout.mode);
  const onTranslationScroll = React.useCallback((page: number, scrollTop: number) => {
    translationScrollOffsets.current.set(page, scrollTop);
  }, []);
  return (
    <div
      ref={rootRef}
      className="paired-page-stream"
      aria-label="PDF 原文与逐页译文"
      data-reading-render-count={renderCount.current}
      data-layout={activeLayout.mode}
      data-render-scale={renderScale.toFixed(2)}
    >
      <span className="visually-hidden" aria-live="polite">
        {activeLayout.fittedToContainer ? 'PDF 已适配阅读区宽度' : ''}
      </span>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => {
        const estimatedSize = pageSizes.get(number) ?? pageSizeEstimates.get(number) ?? { width: 612, height: 792 };
        const layout = computeReadingLayout({
          containerWidth,
          pageWidth: estimatedSize.width,
          requestedScale: renderScale,
          previousMode: pageLayoutModes.current.get(number),
        });
        pageLayoutModes.current.set(number, layout.mode);
        const height = layout.pdfWidth > 0
          ? estimatedSize.height * (layout.pdfWidth / estimatedSize.width)
          : pageHeights.get(number) ?? 780;
        const distanceFromActivePage = Math.abs(number - activePage);
        const renderPriority = distanceFromActivePage === 0
          ? 'visible-final'
          : distanceFromActivePage === 1 ? 'near-preview' : 'idle-preview';
        const maximumOutputScale = distanceFromActivePage === 0 ? 2 : distanceFromActivePage === 1 ? 1.25 : 1;
        const page = model?.pages[number - 1];
        const highlightedBlock = page?.blocks.find((block) => block.id === highlightedBlockId);
        return (
          <PairedPageRow
            key={number}
            number={number}
            height={height}
            layout={layout}
            document={document}
            pdfPage={pageProxyCache.current.get(number)}
            scale={renderScale}
            maximumOutputScale={maximumOutputScale}
            renderPriority={renderPriority}
            renderPdf={renderWindow.has(number)}
            renderTranslation={translationWindow.has(number)}
            page={page}
            translations={translationsByPage.get(number) ?? EMPTY_TRANSLATIONS}
            status={pageStatus.get(number) ?? (translationMode === 'on-demand' ? 'unrequested' : 'pending')}
            failure={pageFailures.get(number)}
            attempt={pageAttempts.get(number)}
            highlightedBlock={highlightedBlock}
            pinnedBlockId={page?.blocks.some((block) => block.id === pinnedBlockId) ? pinnedBlockId : null}
            translationScrollTop={translationScrollOffsets.current.get(number) ?? 0}
            translationPlaceholder={translationPlaceholder}
            onHeightChange={onHeightChange}
            onTranslationScroll={onTranslationScroll}
            onRetryPage={onRetryPage}
            onRequestPage={onRequestPage}
            onCopyFailure={onCopyFailure}
            onBlockPreview={onBlockPreview}
            onBlockPin={onBlockPin}
          />
        );
      })}
    </div>
  );
});

const EMPTY_TRANSLATIONS = new Map<string, TranslationResult>();

const PairedPageRow = React.memo(function PairedPageRow({
  number,
  height,
  layout,
  document,
  pdfPage,
  scale,
  maximumOutputScale,
  renderPriority,
  renderPdf,
  renderTranslation,
  page,
  translations,
  status,
  failure,
  attempt,
  highlightedBlock,
  pinnedBlockId,
  translationScrollTop,
  translationPlaceholder,
  onHeightChange,
  onTranslationScroll,
  onRetryPage,
  onRequestPage,
  onCopyFailure,
  onBlockPreview,
  onBlockPin,
}: {
  number: number;
  height: number;
  layout: ReadingLayout;
  document: PDFDocumentProxy | null;
  pdfPage?: PDFPageProxy;
  scale: number;
  maximumOutputScale: number;
  renderPriority: 'visible-final' | 'near-preview' | 'idle-preview';
  renderPdf: boolean;
  renderTranslation: boolean;
  page?: DocumentModel['pages'][number];
  translations: ReadonlyMap<string, TranslationResult>;
  status: TranslationPageStatus;
  failure?: TranslationFailure;
  attempt?: number;
  highlightedBlock?: DocumentModel['pages'][number]['blocks'][number];
  pinnedBlockId?: string | null;
  translationScrollTop: number;
  translationPlaceholder?: React.ReactNode;
  onHeightChange(page: number, height: number): void;
  onTranslationScroll(page: number, scrollTop: number): void;
  onRetryPage(page: number): void;
  onRequestPage(page: number): void;
  onCopyFailure(failure: TranslationFailure): void;
  onBlockPreview(blockId: string | null): void;
  onBlockPin(blockId: string): void;
}) {
  const handleTranslationScroll = React.useCallback(
    (scrollTop: number) => onTranslationScroll(number, scrollTop),
    [number, onTranslationScroll],
  );
  const handleRequest = React.useCallback(() => onRequestPage(number), [number, onRequestPage]);
  const handleRetry = React.useCallback(() => onRetryPage(number), [number, onRetryPage]);
  return <PagePair
    number={number}
    height={height}
    layout={layout}
    pdf={document && pdfPage && renderPdf
      ? <PdfPageCanvas
        document={document}
        page={pdfPage}
        pageNumber={number}
        scale={scale}
        displayWidth={layout.pdfWidth}
        maximumOutputScale={maximumOutputScale}
        renderPriority={renderPriority}
        onHeightChange={onHeightChange}
        highlightedBlock={highlightedBlock}
      />
      : <div className="pdf-page-placeholder" aria-hidden="true" />}
    translation={page
      ? <TranslationPage
        page={page}
        number={number}
        height={height}
        translations={translations}
        status={status}
        failure={failure}
        attempt={attempt}
        pinnedBlockId={pinnedBlockId}
        renderBody={renderTranslation}
        initialScrollTop={translationScrollTop}
        onScrollTopChange={handleTranslationScroll}
        onBlockPreview={onBlockPreview}
        onBlockPin={onBlockPin}
        onRequest={handleRequest}
        onRetry={handleRetry}
        onCopyFailure={onCopyFailure}
      />
      : <div className="translation-page translation-page-placeholder" style={{ height }}>{translationPlaceholder ?? '等待 MinerU 解析'}</div>}
  />;
});
