import type { PdfSourceTransfer } from './messages';

export class PdfSourceError extends Error {
  readonly name = 'PdfSourceError';

  constructor(readonly code: string) {
    super(code);
  }
}

export async function loadPdfSource(
  rawUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<PdfSourceTransfer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PdfSourceError('PDF_SOURCE_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PdfSourceError('PDF_SOURCE_SCHEME');
  }

  const publicResponse = await safeFetch(fetcher, rawUrl, 'omit', signal);
  const publicBytes = publicResponse?.ok ? await readBytes(publicResponse) : null;
  let kind: PdfSourceTransfer['kind'] = 'remote';
  let bytes = publicBytes;
  if (!bytes || !hasPdfSignature(bytes)) {
    kind = 'authenticated';
    const authenticated = await safeFetch(fetcher, rawUrl, 'include', signal);
    bytes = authenticated?.ok ? await readBytes(authenticated) : null;
  }
  if (!bytes) throw new PdfSourceError('PDF_FETCH_FAILED');
  if (!hasPdfSignature(bytes)) throw new PdfSourceError('PDF_SIGNATURE_INVALID');
  const digestBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestBytes.buffer);
  const hash = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0')).join('');
  const title = decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf');
  return {
    url: rawUrl,
    hash: `sha256:${hash}`,
    title,
    size: bytes.byteLength,
    kind,
    bytes: Array.from(bytes),
  };
}

async function readBytes(response: Response): Promise<Uint8Array> {
  try { return new Uint8Array(await response.arrayBuffer()); }
  catch { throw new PdfSourceError('PDF_READ_FAILED'); }
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

async function safeFetch(
  fetcher: typeof fetch,
  url: string,
  credentials: RequestCredentials,
  signal?: AbortSignal,
): Promise<Response | null> {
  signal?.throwIfAborted();
  try {
    const request = fetcher;
    return await request(url, { credentials, cache: 'no-store', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}
