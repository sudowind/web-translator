import React from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { DocumentBlock } from '../document/model';
import { computePageDisplayMetrics, type PageDisplayMetrics } from './page-layout';
import { PdfBlockHighlightLayer } from './PdfBlockHighlightLayer';
import { sharedPdfRenderQueue, type PdfRenderPriority } from './pdf-render-queue';
import { PdfTextLayer } from './PdfTextLayer';
import { selectDominantPage } from './visible-page';

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  bytes: Uint8Array;
  scale: number;
  activePage: number;
  onPageVisible(page: number, progress: number): void;
  onDocumentReady(pageCount: number): void;
  onPageHeightsChange(heights: ReadonlyMap<number, number>): void;
}

export function visiblePageWindow(
  activePage: number,
  pageCount: number,
  radius = 2,
): Set<number> {
  const pages = new Set<number>();
  for (let page = activePage - radius; page <= activePage + radius; page += 1) {
    if (page >= 1 && page <= pageCount) pages.add(page);
  }
  return pages;
}

export function PdfViewer({
  bytes,
  scale,
  activePage,
  onPageVisible,
  onDocumentReady,
  onPageHeightsChange,
}: PdfViewerProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const initialPagePositioned = React.useRef(false);
  const activePageRef = React.useRef(activePage);
  const lastReportedPage = React.useRef<number | null>(null);
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  activePageRef.current = activePage;

  React.useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: bytes });
    void task.promise.then((pdf) => {
      if (cancelled) {
        return;
      }
      setDocument(pdf);
      setPageCount(pdf.numPages);
      onDocumentReady(pdf.numPages);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, onDocumentReady]);

  React.useLayoutEffect(() => {
    if (initialPagePositioned.current || pageCount === 0 || !rootRef.current) return;
    const page = Math.min(Math.max(activePage, 1), pageCount);
    const target = rootRef.current.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (!target) return;
    rootRef.current.scrollTop = target.offsetTop;
    initialPagePositioned.current = true;
  }, [activePage, pageCount]);

  React.useEffect(() => {
    if (!rootRef.current || pageCount === 0) return;
    const visibility = new Map<number, { ratio: number; progress: number }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.pdfPage);
        if (!entry.isIntersecting) {
          visibility.delete(page);
          continue;
        }
        const rootTop = entry.rootBounds?.top ?? 0;
        const height = Math.max(1, entry.boundingClientRect.height);
        const progress = Math.max(0, Math.min(1, (rootTop - entry.boundingClientRect.top) / height));
        visibility.set(page, { ratio: entry.intersectionRatio, progress });
      }
      const page = selectDominantPage(
        Array.from(visibility, ([candidate, value]) => ({ page: candidate, intersectionRatio: value.ratio })),
        lastReportedPage.current ?? activePageRef.current,
      );
      if (page === null || page === lastReportedPage.current) return;
      lastReportedPage.current = page;
      onPageVisible(page, visibility.get(page)?.progress ?? 0);
    }, { root: rootRef.current, threshold: [0.25, 0.6] });
    rootRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [pageCount, onPageVisible]);

  React.useEffect(() => {
    if (!rootRef.current || pageCount === 0) return;
    const heights = new Map<number, number>();
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.pdfPage);
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (!Number.isInteger(page) || height <= 0 || heights.get(page) === height) continue;
        heights.set(page, height);
        changed = true;
      }
      if (changed) onPageHeightsChange(new Map(heights));
    });
    rootRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [pageCount, onPageHeightsChange]);

  const window = visiblePageWindow(activePage, pageCount);
  return (
    <div ref={rootRef} className="pdf-pages" aria-label="PDF 原文页面">
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
        <section
          key={page}
          className="pdf-page-slot"
          data-pdf-page={page}
          aria-label={`PDF 第 ${page} 页`}
        >
          {document && window.has(page)
            ? <PdfPageCanvas document={document} pageNumber={page} scale={scale} />
            : <div className="pdf-page-placeholder" aria-hidden="true" />}
        </section>
      ))}
    </div>
  );
}

export function PdfPageCanvas({
  document,
  page: suppliedPage,
  pageNumber,
  scale,
  displayWidth,
  maximumOutputScale,
  renderPriority = 'visible-final',
  onHeightChange,
  highlightedBlock,
}: {
  document: PDFDocumentProxy;
  page?: PDFPageProxy;
  pageNumber: number;
  scale: number;
  displayWidth?: number;
  maximumOutputScale?: number;
  renderPriority?: PdfRenderPriority;
  onHeightChange?(pageNumber: number, height: number): void;
  highlightedBlock?: DocumentBlock;
}) {
  const firstCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const secondCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const activeBuffer = React.useRef<number | null>(null);
  const retainedMaximumOutputScale = React.useRef(maximumOutputScale ?? 2);
  const retainedRenderPriority = React.useRef(renderPriority);
  const [devicePixelRatio, setDevicePixelRatio] = React.useState(() => globalThis.devicePixelRatio || 1);
  const [committedFrame, setCommittedFrame] = React.useState<{
    page: PDFPageProxy;
    viewport: PageViewport;
    renderId: number;
    bufferIndex: number;
    metrics: PageDisplayMetrics;
  } | null>(null);
  const [pendingMetrics, setPendingMetrics] = React.useState<PageDisplayMetrics>();
  const [renderError, setRenderError] = React.useState<string>();
  const [rendering, setRendering] = React.useState(false);
  const renderGeneration = React.useRef(0);
  const activeTextLayers = React.useRef(new Set<number>());
  const textLayerWaiters = React.useRef<Array<() => void>>([]);
  retainedMaximumOutputScale.current = Math.max(retainedMaximumOutputScale.current, maximumOutputScale ?? 2);
  const priorityRank: Record<PdfRenderPriority, number> = { 'visible-final': 0, 'near-preview': 1, 'idle-preview': 2 };
  if (priorityRank[renderPriority] < priorityRank[retainedRenderPriority.current]) retainedRenderPriority.current = renderPriority;
  const effectiveMaximumOutputScale = retainedMaximumOutputScale.current;
  const effectiveRenderPriority = retainedRenderPriority.current;
  const suppliedMetrics = React.useMemo(() => {
    if (!suppliedPage) return undefined;
    const baseViewport = suppliedPage.getViewport({ scale: 1 });
    return computePageDisplayMetrics({
      baseWidth: baseViewport.width,
      baseHeight: baseViewport.height,
      requestedScale: scale,
      allocatedWidth: displayWidth ?? baseViewport.width * scale,
      devicePixelRatio,
      maximumOutputScale: effectiveMaximumOutputScale,
    });
  }, [devicePixelRatio, displayWidth, effectiveMaximumOutputScale, scale, suppliedPage]);
  const targetMetrics = suppliedMetrics ?? pendingMetrics ?? committedFrame?.metrics;
  const handleTextLayerError = React.useCallback(() => setRenderError('PDF 文本层渲染失败'), []);
  const handleTextLayerActiveChange = React.useCallback((renderId: number, active: boolean) => {
    if (active) activeTextLayers.current.add(renderId);
    else activeTextLayers.current.delete(renderId);
    if (activeTextLayers.current.size === 0) textLayerWaiters.current.splice(0).forEach((resolve) => resolve());
  }, []);

  React.useEffect(() => {
    const updatePixelRatio = () => {
      const nextRatio = globalThis.devicePixelRatio || 1;
      setDevicePixelRatio((current) => Math.abs(current - nextRatio) < 0.05 ? current : nextRatio);
    };
    globalThis.addEventListener?.('resize', updatePixelRatio);
    return () => globalThis.removeEventListener?.('resize', updatePixelRatio);
  }, []);

  React.useEffect(() => {
    const generation = ++renderGeneration.current;
    let cancelled = false;
    let frameCommitted = false;
    let renderTask: RenderTask | undefined;
    let releaseRenderSlot: (() => void) | undefined;
    let pageProxy: PDFPageProxy | undefined;
    let renderedCanvas: HTMLCanvasElement | undefined;
    let renderSettled: Promise<unknown> = Promise.resolve();
    const queueController = new AbortController();
    setRenderError(undefined);
    setRendering(true);
    void Promise.resolve(suppliedPage ?? document.getPage(pageNumber)).then(async (page) => {
      if (cancelled) return;
      pageProxy = page;
      const baseViewport = page.getViewport({ scale: 1 });
      const metrics = computePageDisplayMetrics({
        baseWidth: baseViewport.width,
        baseHeight: baseViewport.height,
        requestedScale: scale,
        allocatedWidth: displayWidth ?? baseViewport.width * scale,
        devicePixelRatio,
        maximumOutputScale: effectiveMaximumOutputScale,
      });
      if (cancelled) return;
      setPendingMetrics(metrics);
      const viewport = page.getViewport({ scale: metrics.displayScale });
      const bufferIndex = activeBuffer.current === 0 ? 1 : 0;
      const canvas = bufferIndex === 0 ? firstCanvasRef.current : secondCanvasRef.current;
      if (!canvas) return;
      releaseRenderSlot = await sharedPdfRenderQueue.acquire(effectiveRenderPriority, queueController.signal);
      try {
        if (cancelled) return;
        renderedCanvas = canvas;
        canvas.width = metrics.bitmapWidth;
        canvas.height = metrics.bitmapHeight;
        canvas.style.width = `${metrics.cssWidth}px`;
        canvas.style.height = `${metrics.cssHeight}px`;
        renderTask = page.render({
          canvas,
          viewport,
          transform: metrics.outputScale === 1
            ? undefined
            : [metrics.outputScale, 0, 0, metrics.outputScale, 0, 0],
        });
        renderSettled = renderTask.promise;
        await renderSettled;
      } finally {
        releaseRenderSlot?.();
        releaseRenderSlot = undefined;
      }
      if (cancelled || generation !== renderGeneration.current) return;
      frameCommitted = true;
      activeBuffer.current = bufferIndex;
      setCommittedFrame({ page, viewport, renderId: generation, bufferIndex, metrics });
      setRendering(false);
      onHeightChange?.(pageNumber, metrics.cssHeight);
    }).catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && ['AbortError', 'RenderingCancelledException'].includes(error.name))) {
        setRenderError('PDF 页面渲染失败');
        setRendering(false);
      }
    });
    return () => {
      cancelled = true;
      queueController.abort();
      renderTask?.cancel();
      if (!frameCommitted && renderedCanvas && activeBuffer.current !== (renderedCanvas === firstCanvasRef.current ? 0 : 1)) {
        renderedCanvas.width = 0;
        renderedCanvas.height = 0;
      }
      void renderSettled.catch(() => undefined).then(async () => {
        if (renderGeneration.current !== generation) return;
        if (activeTextLayers.current.size > 0) {
          await new Promise<void>((resolve) => textLayerWaiters.current.push(resolve));
        }
        if (renderGeneration.current === generation) pageProxy?.cleanup();
      });
    };
  }, [devicePixelRatio, displayWidth, document, effectiveMaximumOutputScale, effectiveRenderPriority, onHeightChange, pageNumber, scale, suppliedPage]);

  React.useLayoutEffect(() => {
    if (!committedFrame) return;
    const inactiveCanvas = committedFrame.bufferIndex === 0 ? secondCanvasRef.current : firstCanvasRef.current;
    if (!inactiveCanvas) return;
    inactiveCanvas.width = 0;
    inactiveCanvas.height = 0;
    inactiveCanvas.style.removeProperty('width');
    inactiveCanvas.style.removeProperty('height');
  }, [committedFrame]);

  React.useEffect(() => {
    const canvases = [firstCanvasRef.current, secondCanvasRef.current];
    return () => {
      for (const canvas of canvases) {
        if (!canvas) continue;
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  React.useLayoutEffect(() => {
    if (targetMetrics && targetMetrics.cssHeight > 0) onHeightChange?.(pageNumber, targetMetrics.cssHeight);
  }, [onHeightChange, pageNumber, targetMetrics]);

  const previewFitScale = committedFrame && targetMetrics
    ? Math.min(1, targetMetrics.cssWidth / committedFrame.metrics.cssWidth)
    : 1;

  return (
    <div
      className="pdf-page-canvas-wrap"
      data-rendering={rendering}
      data-output-scale={committedFrame?.metrics.outputScale}
      data-fitted-to-container={targetMetrics?.fittedToContainer || undefined}
      style={targetMetrics ? { width: targetMetrics.cssWidth, height: targetMetrics.cssHeight } : undefined}
    >
      <canvas ref={firstCanvasRef} data-pdf-canvas-buffer="0" data-active={committedFrame?.bufferIndex === 0} />
      <canvas ref={secondCanvasRef} data-pdf-canvas-buffer="1" data-active={committedFrame?.bufferIndex === 1} />
      <PdfBlockHighlightLayer polygon={highlightedBlock?.polygon} />
      {committedFrame && <PdfTextLayer
        page={committedFrame.page}
        viewport={committedFrame.viewport}
        renderId={committedFrame.renderId}
        fitScale={previewFitScale}
        onError={handleTextLayerError}
        onActiveChange={handleTextLayerActiveChange}
      />}
      {renderError && <p className="pdf-page-render-error" role="status">{renderError}</p>}
    </div>
  );
}
