import React from 'react';
import {
  TextLayer,
  type PDFPageProxy,
  type PageViewport,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

interface TextLayerOptions {
  textContentSource: ReturnType<PDFPageProxy['streamTextContent']>;
  container: HTMLElement;
  viewport: PageViewport;
}

interface TextLayerHandle {
  render(): Promise<unknown>;
  cancel(): void;
}

export type TextLayerFactory = (options: TextLayerOptions) => TextLayerHandle;

const createPdfJsTextLayer: TextLayerFactory = (options) => new TextLayer(options);

export function PdfTextLayer({
  page,
  viewport,
  fitScale = 1,
  createLayer = createPdfJsTextLayer,
  onError,
}: {
  page: PDFPageProxy;
  viewport: PageViewport;
  fitScale?: number;
  createLayer?: TextLayerFactory;
  onError?(error: unknown): void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    let cancelled = false;
    const layer = createLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    void layer.render().catch((error: unknown) => {
      if (!cancelled) onError?.(error);
    });
    return () => {
      cancelled = true;
      layer.cancel();
      container.replaceChildren();
    };
  }, [createLayer, onError, page, viewport]);

  return <div
    ref={containerRef}
    className="pdf-text-layer textLayer"
    aria-label="可选择 PDF 文本"
    style={{
      width: viewport.width,
      height: viewport.height,
      transform: `scale(${fitScale})`,
      transformOrigin: '0 0',
    }}
  />;
}
