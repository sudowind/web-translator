import type { HistoryEntry } from '../storage/repositories';

const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 300;

export function normalizeHistoryUrl(rawUrl: string): string {
  if (rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) throw new Error('HISTORY_URL_INVALID');
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('HISTORY_URL_INVALID');
  url.hash = '';
  return url.href;
}

export function historyEntryId(kind: HistoryEntry['kind'], url: string, documentHash?: string): string {
  return kind === 'pdf' && documentHash?.trim()
    ? `pdf:${documentHash.trim()}`
    : `${kind}:${normalizeHistoryUrl(url)}`;
}

export function safeHistoryTitle(title: string, rawUrl: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH);
  return normalized || new URL(normalizeHistoryUrl(rawUrl)).hostname;
}

export function historyUrlWithPage(entry: HistoryEntry): string {
  if (entry.kind !== 'pdf' || !entry.lastPage || entry.lastPage < 1) return entry.url;
  const url = new URL(entry.url);
  url.hash = `page=${entry.lastPage}`;
  return url.href;
}
