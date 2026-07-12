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
import { PdfBlockHighlightLayer } from './PdfBlockHighlightLayer';
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
    const task = getDocument({ data: bytes.slice() });
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
  pageNumber,
  scale,
  onHeightChange,
  highlightedBlock,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onHeightChange?(pageNumber: number, height: number): void;
  highlightedBlock?: DocumentBlock;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [textLayer, setTextLayer] = React.useState<{ page: PDFPageProxy; viewport: PageViewport } | null>(null);
  const [renderError, setRenderError] = React.useState<string>();
  const handleTextLayerError = React.useCallback(() => setRenderError('PDF 文本层渲染失败'), []);

  React.useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    setTextLayer(null);
    setRenderError(undefined);
    void document.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ratio = globalThis.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setTextLayer({ page, viewport });
      renderTask = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
    }).catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
        setRenderError('PDF 页面渲染失败');
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, onHeightChange, pageNumber, scale]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onHeightChange) return;
    const report = () => {
      if (!canvas.style.width) return;
      const height = canvas.getBoundingClientRect().height;
      if (height > 0) onHeightChange(pageNumber, height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(canvas);
    report();
    return () => observer.disconnect();
  }, [onHeightChange, pageNumber]);

  return (
    <div className="pdf-page-canvas-wrap">
      <canvas ref={canvasRef} />
      <PdfBlockHighlightLayer polygon={highlightedBlock?.polygon} />
      {textLayer && <PdfTextLayer
        page={textLayer.page}
        viewport={textLayer.viewport}
        onError={handleTextLayerError}
      />}
      {renderError && <p className="pdf-page-render-error" role="status">{renderError}</p>}
    </div>
  );
}
