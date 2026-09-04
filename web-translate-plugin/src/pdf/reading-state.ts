import { resolveArxivSource } from './arxiv-source';

export interface PdfReadingPosition { page: number; progress: number; scale: number }
export interface PdfReadingState extends PdfReadingPosition { enabled: boolean; updatedAt: number }
interface LocalStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function pdfReadingIdentity(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const arxiv = resolveArxivSource(rawUrl);
    if (arxiv) return /^\/pdf\//i.test(url.pathname) ? arxiv.key : null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function pdfSitePermission(rawUrl: string): string | null {
  if (!pdfReadingIdentity(rawUrl)) return null;
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export function isPdfReadingPosition(value: unknown): value is PdfReadingPosition {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.page) && Number(record.page) >= 1 && Number(record.page) <= 100_000 &&
    typeof record.progress === 'number' && Number.isFinite(record.progress) && record.progress >= 0 && record.progress <= 1 &&
    typeof record.scale === 'number' && Number.isFinite(record.scale) && record.scale >= 0.25 && record.scale <= 5;
}

export class PdfReadingStateStore {
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly local: LocalStoragePort = browser.storage.local) {}

  private async key(url: string): Promise<string | null> {
    const identity = pdfReadingIdentity(url);
    if (!identity) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return `pdf-reading-v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async get(url: string): Promise<PdfReadingState | null> {
    const key = await this.key(url);
    if (!key) return null;
    await this.writes.get(key);
    return this.read(key);
  }

  private async read(key: string): Promise<PdfReadingState | null> {
    const value = (await this.local.get(key))[key];
    if (!isPdfReadingPosition(value)) return null;
    const state = value as PdfReadingState;
    return typeof state.enabled === 'boolean' && Number.isFinite(state.updatedAt) ? state : null;
  }

  private async update(url: string, patch: Partial<PdfReadingState>, isCurrent = () => true): Promise<void> {
    const key = await this.key(url);
    if (!key) return;
    const pending = (this.writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const previous = await this.read(key);
      if (!isCurrent()) return;
      await this.local.set({ [key]: { enabled: false, page: 1, progress: 0, scale: 1.1, ...previous, ...patch, updatedAt: Date.now() } });
    });
    this.writes.set(key, pending);
    try { await pending; }
    finally { if (this.writes.get(key) === pending) this.writes.delete(key); }
  }

  setEnabled(url: string, enabled: boolean): Promise<void> { return this.update(url, { enabled }); }
  savePosition(url: string, position: PdfReadingPosition, isCurrent = () => true): Promise<void> {
    if (!isPdfReadingPosition(position)) return Promise.reject(new Error('PDF_READING_POSITION_INVALID'));
    return this.update(url, { page: position.page, progress: position.progress, scale: position.scale }, isCurrent);
  }
}

export type PdfReadingMessage = { type: 'pdf:reading-get' } | ({ type: 'pdf:reading-save' } & PdfReadingPosition);
export function isPdfReadingMessage(value: unknown): value is PdfReadingMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.type === 'pdf:reading-get' && Object.keys(record).length === 1) ||
    (record.type === 'pdf:reading-save' && Object.keys(record).length === 4 && isPdfReadingPosition(record));
}
