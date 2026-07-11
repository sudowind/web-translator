import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';

export interface PdfSourceTransfer {
  url: string;
  hash: string;
  title: string;
  size: number;
  kind: 'remote' | 'authenticated';
  bytes: number[];
}

export type PdfMessage =
  | { type: 'pdf:source'; url: string }
  | { type: 'pdf:parse-start'; source: PdfSourceTransfer; pageCount: number; consent: boolean }
  | { type: 'pdf:document-get'; hash: string }
  | { type: 'pdf:translate-page'; hash: string; page: number }
  | { type: 'pdf:cancel' }
  | { type: 'pdf:cache-clear'; hash: string };

export type PdfMessageValue =
  | PdfSourceTransfer
  | DocumentModel
  | TranslationResult[]
  | { cancelled: true }
  | { cleared: true }
  | null;

export type PdfMessageResponse =
  | { ok: true; value: PdfMessageValue }
  | { ok: false; error: string };

export function isPdfMessage(value: unknown): value is PdfMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'pdf:source':
      return exact(value, ['type', 'url']) && nonEmpty(value.url);
    case 'pdf:parse-start':
      return exact(value, ['type', 'source', 'pageCount', 'consent']) &&
        isPdfSource(value.source) && positiveInteger(value.pageCount) &&
        (value.pageCount as number) <= 600 && typeof value.consent === 'boolean';
    case 'pdf:document-get':
    case 'pdf:cache-clear':
      return exact(value, ['type', 'hash']) && nonEmpty(value.hash);
    case 'pdf:translate-page':
      return exact(value, ['type', 'hash', 'page']) && nonEmpty(value.hash) && positiveInteger(value.page);
    case 'pdf:cancel':
      return exact(value, ['type']);
    default:
      return false;
  }
}

function isPdfSource(value: unknown): value is PdfSourceTransfer {
  return isRecord(value) &&
    exact(value, ['url', 'hash', 'title', 'size', 'kind', 'bytes']) &&
    nonEmpty(value.url) && nonEmpty(value.hash) && nonEmpty(value.title) &&
    Number.isSafeInteger(value.size) && (value.size as number) >= 0 &&
    (value.kind === 'remote' || value.kind === 'authenticated') &&
    Array.isArray(value.bytes) && value.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
