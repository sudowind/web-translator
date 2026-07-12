import React from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  bytes: Uint8Array;
  scale: number;
  activePage: number;
  onPageVisible(page: number, progress: number): void;
  onDocumentReady(pageCount: number): void;
}

export function visiblePageWindow(
  activePage: number,
  pageCount: number,
): Set<number> {
  const pages = new Set<number>();
  for (let page = activePage - 1; page <= activePage + 1; page += 1) {
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
}: PdfViewerProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const initialPagePositioned = React.useRef(false);
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = React.useState(0);

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
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = Number((entry.target as HTMLElement).dataset.pdfPage);
        const rootTop = entry.rootBounds?.top ?? 0;
        const height = Math.max(1, entry.boundingClientRect.height);
        const progress = Math.max(0, Math.min(1, (rootTop - entry.boundingClientRect.top) / height));
        onPageVisible(page, progress);
      }
    }, { root: rootRef.current, threshold: [0.25, 0.6] });
    rootRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [pageCount, onPageVisible]);

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

function PdfPageCanvas({
  document,
  pageNumber,
  scale,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [text, setText] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void document.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ratio = globalThis.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      const textContent = await page.getTextContent();
      if (!cancelled) {
        setText(textContent.items
          .map((item) => 'str' in item ? item.str : '')
          .join(' '));
      }
      await renderTask.promise;
    }).catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
        setText('PDF 页面渲染失败');
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, scale]);

  return (
    <div className="pdf-page-canvas-wrap">
      <canvas ref={canvasRef} />
      <p className="pdf-text-layer" aria-label={`第 ${pageNumber} 页可选择文本`}>{text}</p>
    </div>
  );
}
