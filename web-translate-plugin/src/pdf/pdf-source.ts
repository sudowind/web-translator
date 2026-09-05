import type { PdfSourceDescriptor } from './messages';
import { resolveArxivSource } from './arxiv-source';

export interface LoadedPdfSource {
  descriptor: PdfSourceDescriptor;
  bytes: Uint8Array<ArrayBuffer>;
}

export class PdfSourceError extends Error {
  override readonly name = 'PdfSourceError';

  constructor(readonly code: string) {
    super(code);
  }
}

export async function loadPdfSource(
  rawUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<LoadedPdfSource> {
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
  const publicBytes = publicResponse?.ok ? await tryReadBytes(publicResponse) : null;
  let kind: PdfSourceDescriptor['kind'] = 'remote';
  let bytes = publicBytes;
  let sourceResponse = publicResponse;
  if (!bytes || !hasPdfSignature(bytes)) {
    kind = 'authenticated';
    const authenticated = await safeFetch(fetcher, rawUrl, 'include', signal);
    bytes = authenticated?.ok ? await readBytes(authenticated) : null;
    sourceResponse = authenticated;
  }
  if (!bytes) throw new PdfSourceError('PDF_FETCH_FAILED');
  if (!hasPdfSignature(bytes)) throw new PdfSourceError('PDF_SIGNATURE_INVALID');
  const arxiv = resolveArxivSource(rawUrl);
  const hash = arxiv?.key ?? await sha256(bytes);
  const title = arxiv?.title ?? resolvePdfTitle(url, sourceResponse);
  return {
    descriptor: {
      url: arxiv?.pdfUrl ?? rawUrl,
      hash,
      title,
      size: bytes.byteLength,
      kind,
    },
    bytes,
  };
}

export function resolvePdfTitle(url: URL, response?: Response | null): string {
  const disposition = response?.headers?.get('content-disposition') ?? '';
  const encodedName = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1];
  const plainMatch = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  const headerName = encodedName
    ? safeDecode(encodedName.trim().replace(/^"|"$/g, ''))
    : plainMatch?.[1] ?? plainMatch?.[2]?.trim();
  const safeHeaderName = sanitizePdfTitle(headerName);
  if (safeHeaderName) return ensurePdfExtension(safeHeaderName);

  const pathName = sanitizePdfTitle(safeDecode(url.pathname.split('/').pop() || ''));
  if (pathName && !/^(?:download|document|pdf)$/i.test(pathName)) {
    return ensurePdfExtension(pathName);
  }

  for (const key of ['filename', 'file', 'id', 'paper', 'document']) {
    const candidate = url.searchParams.get(key);
    if (!candidate || !/^[\p{L}\p{N}._-]{1,80}$/u.test(candidate)) continue;
    const safeCandidate = sanitizePdfTitle(candidate);
    if (safeCandidate) return ensurePdfExtension(safeCandidate);
  }
  return pathName ? ensurePdfExtension(pathName) : 'document.pdf';
}

async function readBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  try { return new Uint8Array(await response.arrayBuffer()); }
  catch { throw new PdfSourceError('PDF_READ_FAILED'); }
}

async function tryReadBytes(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  try { return await readBytes(response); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function sanitizePdfTitle(value?: string): string {
  return (value ?? '')
    .split(/[\\/]/).pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 160);
}

function ensurePdfExtension(value: string): string {
  return /\.pdf$/i.test(value) ? value : `${value}.pdf`;
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
    return await request(url, { credentials, cache: credentials === 'omit' ? 'default' : 'no-store', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `sha256:${hash}`;
}
