import type { PdfDetectionInput, PdfTargetKind } from './contracts';

export function classifyPdfTarget(input: PdfDetectionInput): PdfTargetKind | null {
  let url: URL;

  try {
    url = new URL(input.url);
  } catch {
    return null;
  }

  const pathname = url.pathname.toLowerCase();
  const isArxivPdf = url.hostname === 'arxiv.org' && pathname.startsWith('/pdf/');
  const isPdf =
    input.contentType?.toLowerCase().includes('application/pdf') === true ||
    pathname.endsWith('.pdf') ||
    isArxivPdf;

  if (!isPdf) {
    return null;
  }

  if (url.protocol === 'file:') {
    return 'local';
  }

  if (isArxivPdf) {
    return 'arxiv';
  }

  return 'remote';
}
