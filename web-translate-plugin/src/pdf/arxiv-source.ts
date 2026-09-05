import type { PdfSourceDescriptor } from './messages';

const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v([1-9]\d*))?$/i;
const REVISION_TIMEOUT_MS = 2_000;

export interface ArxivSourceIdentity {
  id: string;
  key: string;
  pdfUrl: string;
  title: string;
  version: number | null;
}

export function resolveArxivSource(rawUrl: string): ArxivSourceIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!ARXIV_HOSTS.has(url.hostname.toLowerCase())) return null;
  const path = safeDecode(url.pathname);
  const match = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i.exec(path);
  if (!match) return null;
  const candidate = match[1].replace(/\/$/, '');
  const idMatch = ARXIV_ID.exec(candidate);
  if (!idMatch || !hasValidArxivDateAndSerial(candidate)) return null;
  const id = candidate.toLowerCase();
  const version = idMatch[1] ? Number.parseInt(idMatch[1], 10) : null;
  return {
    id,
    key: `arxiv:${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    title: `${id.replace('/', '-')}.pdf`,
    version,
  };
}

export function describeArxivPdfSource(rawUrl: string): PdfSourceDescriptor | null {
  const identity = resolveArxivSource(rawUrl);
  if (!identity) return null;
  return {
    url: identity.pdfUrl,
    hash: identity.key,
    title: identity.title,
    size: 0,
    kind: 'remote',
  };
}

export function samePdfSource(left: string, right: string): boolean {
  if (left === right) return true;
  const leftIdentity = resolveArxivSource(left);
  const rightIdentity = resolveArxivSource(right);
  return leftIdentity !== null && rightIdentity !== null && leftIdentity.key === rightIdentity.key;
}

export function arxivSourceKeyMatches(url: string, key: string): boolean {
  const identity = resolveArxivSource(url);
  return identity === null || identity.key === key;
}

export function arxivSourceUrlCandidates(identity: ArxivSourceIdentity, rawUrl?: string): string[] {
  const candidates = [
    identity.pdfUrl,
    `${identity.pdfUrl}.pdf`,
    `https://arxiv.org/abs/${identity.id}`,
  ];
  if (rawUrl) {
    candidates.unshift(rawUrl);
    try {
      const withoutFragment = new URL(rawUrl);
      withoutFragment.hash = '';
      candidates.unshift(withoutFragment.href);
    } catch {
      // 原始 URL 已由身份解析器校验；这里只跳过不可复用的兼容候选。
    }
  }
  return [...new Set(candidates)];
}

export async function readArxivSourceRevision(
  pdfUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort('ARXIV_REVISION_TIMEOUT'), REVISION_TIMEOUT_MS);
  try {
    const response = await fetcher(pdfUrl, {
      method: 'HEAD',
      credentials: 'omit',
      cache: 'no-cache',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const etag = response.headers.get('etag')?.trim();
    if (etag) return `etag:${etag}`;
    const modified = response.headers.get('last-modified')?.trim();
    const length = response.headers.get('content-length')?.trim();
    if (modified || length) return `http:${modified ?? ''}:${length ?? ''}`;
    return undefined;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return undefined;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function hasValidArxivDateAndSerial(candidate: string): boolean {
  const withoutVersion = candidate.replace(/v[1-9]\d*$/i, '');
  const numeric = withoutVersion.includes('/')
    ? withoutVersion.slice(withoutVersion.lastIndexOf('/') + 1)
    : withoutVersion;
  const match = numeric.includes('.')
    ? /^(\d{2})(\d{2})\.(\d{4,5})$/.exec(numeric)
    : /^(\d{2})(\d{2})(\d{3})$/.exec(numeric);
  if (!match) return false;
  const month = Number.parseInt(match[2], 10);
  const serial = Number.parseInt(match[3], 10);
  return month >= 1 && month <= 12 && serial > 0;
}
