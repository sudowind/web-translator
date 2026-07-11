interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<unknown> };
}

interface PdfDocument {
  getPage(pageNumber: number): Promise<PdfPage>;
}

export type PdfDocumentLoader = (url: string) => {
  promise: Promise<PdfDocument>;
};

export async function renderPdfFirstPage(
  url: string,
  loadDocument: PdfDocumentLoader,
) {
  const previous = document.documentElement.innerHTML;
  sessionStorage.setItem('web-translate:probe:previous', previous);
  document.documentElement.innerHTML =
    '<head><title>PDF 接管探针</title></head><body><main id="web-translate-probe-root" data-renderer="pdfjs-probe"><canvas aria-label="PDF.js 渲染第一页"></canvas></main></body>';

  try {
    const root = document.getElementById('web-translate-probe-root');
    const canvas = root?.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!root || !canvas || !context) throw new Error('PDF.js canvas 初始化失败');

    const pdf = await loadDocument(url).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    root.dataset.renderedPage = '1';

    return {
      href: location.href,
      injected: true,
      rendererVerified: canvas.width > 0 && canvas.height > 0,
    };
  } catch (error) {
    document.documentElement.innerHTML = previous;
    sessionStorage.removeItem('web-translate:probe:previous');
    throw error;
  }
}
