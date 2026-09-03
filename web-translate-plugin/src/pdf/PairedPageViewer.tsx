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
import { PdfPageCanvas, visiblePageWindow } from './PdfViewer';
import { TranslationPage, type TranslationPageStatus } from './TranslationPane';
import { selectDominantPage } from './visible-page';

export interface PagePairProps {
  number: number;
  height: number;
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

export function PagePair({ number, height, pdf, translation }: PagePairProps) {
  return (
    <section
      className="page-pair"
      data-page-pair={number}
      aria-label={`第 ${number} 页原文与译文`}
      style={{ height }}
    >
      <div className="page-pair-pdf" data-pdf-page={number} style={{ height }}>{pdf}</div>
      <div className="page-pair-translation" style={{ height }}>{translation}</div>
    </section>
  );
}

interface PairedPageViewerProps {
  bytes: Uint8Array;
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
  const [pageCount, setPageCount] = React.useState(0);
  const [pageSizes, setPageSizes] = React.useState<ReadonlyMap<number, { width: number; height: number }>>(new Map());
  const [pageHeights, setPageHeights] = React.useState<ReadonlyMap<number, number>>(new Map());
  const translationScrollOffsets = React.useRef(new Map<number, number>());
  const pageSizeCache = React.useRef(new Map<number, { width: number; height: number }>());
  const pageSizeLoads = React.useRef(new Map<number, Promise<{ width: number; height: number }>>());
  const pageProxyCache = React.useRef(new Map<number, PDFPageProxy>());
  activePageRef.current = activePage;

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
    setPageSizes(new Map());
    setPageHeights(new Map());
    const task = getDocument({ data: bytes });
    void task.promise.then((pdf) => {
      if (cancelled) return;
      setDocument(pdf);
      setPageCount(pdf.numPages);
      onDocumentReady(pdf.numPages);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, onDocumentReady]);

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
    const availableWidth = rootRef.current?.querySelector<HTMLElement>('.page-pair-pdf')?.clientWidth ?? 0;
    if (availableWidth <= 0 || pageSizes.size === 0) return;
    const measured = new Map(Array.from(pageSizes, ([number, size]) => [
      number,
      fitPageHeight(size.width * scale, size.height * scale, availableWidth),
    ]));
    setPageHeights((current) => mapsNearlyEqual(current, measured) ? current : measured);
  }, [pageSizes, scale]);

  React.useLayoutEffect(fitAllPageHeights, [fitAllPageHeights]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(fitAllPageHeights);
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitAllPageHeights]);

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
  const availableWidth = rootRef.current?.querySelector<HTMLElement>('.page-pair-pdf')?.clientWidth ?? 0;
  const onTranslationScroll = React.useCallback((page: number, scrollTop: number) => {
    translationScrollOffsets.current.set(page, scrollTop);
  }, []);
  return (
    <div
      ref={rootRef}
      className="paired-page-stream"
      aria-label="PDF 原文与逐页译文"
      data-reading-render-count={renderCount.current}
    >
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => {
        const estimatedSize = pageSizeEstimates.get(number);
        const height = pageHeights.get(number) ?? (estimatedSize && availableWidth > 0
          ? fitPageHeight(estimatedSize.width * scale, estimatedSize.height * scale, availableWidth)
          : 780);
        const page = model?.pages[number - 1];
        const highlightedBlock = page?.blocks.find((block) => block.id === highlightedBlockId);
        return (
          <PairedPageRow
            key={number}
            number={number}
            height={height}
            document={document}
            pdfPage={pageProxyCache.current.get(number)}
            scale={scale}
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
  document,
  pdfPage,
  scale,
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
  document: PDFDocumentProxy | null;
  pdfPage?: PDFPageProxy;
  scale: number;
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
    pdf={document && pdfPage && renderPdf
      ? <PdfPageCanvas document={document} page={pdfPage} pageNumber={number} scale={scale} onHeightChange={onHeightChange} highlightedBlock={highlightedBlock} />
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
