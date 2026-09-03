import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import type { AgentMessage } from '../agent/context-builder';
import type { TranslationFailure } from '../translation/failure';

export interface PdfSourceDescriptor {
  url: string;
  hash: string;
  title: string;
  size: number;
  kind: 'remote' | 'authenticated';
}

export interface PdfTranslationSnapshotPage {
  page: number;
  blocks: TranslationResult[];
}

export interface PdfTranslationSnapshot {
  pages: PdfTranslationSnapshotPage[];
}

export type PdfMessage =
  | { type: 'pdf:parse-start'; source: PdfSourceDescriptor; pageCount: number; consent: boolean }
  | { type: 'pdf:document-get'; hash: string }
  | { type: 'pdf:translation-snapshot'; hash: string }
  | { type: 'pdf:translate-page'; hash: string; page: number }
  | { type: 'pdf:history-update'; hash: string; title: string; page: number; pageCount: number }
  | { type: 'pdf:agent-ask'; hash: string; requestId: string; activePage: number; selection: string; recentMessages: AgentMessage[]; question: string; maxCharacters: number }
  | { type: 'pdf:agent-cancel' }
  | { type: 'pdf:cancel' }
  | { type: 'pdf:cache-clear'; hash: string };

export type PdfMessageValue =
  | DocumentModel
  | TranslationResult[]
  | PdfTranslationSnapshot
  | { answer: string; mode: 'full' | 'compressed'; notice?: string }
  | { cancelled: true }
  | { cleared: true }
  | { historyUpdated: true }
  | null;

export type PdfMessageResponse =
  | { ok: true; value: PdfMessageValue }
  | { ok: false; error: string; failure?: TranslationFailure };

export interface PdfTranslationProgress {
  type: 'pdf:translation-progress';
  hash: string;
  page: number;
  attempt: number;
  maxAttempts: 3;
}

export interface PdfAgentProgress {
  type: 'pdf:agent-progress';
  hash: string;
  requestId: string;
  delta: string;
}

export function isPdfAgentProgress(value: unknown): value is PdfAgentProgress {
  return isRecord(value) && exact(value, ['type', 'hash', 'requestId', 'delta']) &&
    value.type === 'pdf:agent-progress' && nonEmpty(value.hash) &&
    nonEmpty(value.requestId) && typeof value.delta === 'string' && value.delta.length > 0;
}

export function isPdfTranslationProgress(value: unknown): value is PdfTranslationProgress {
  return isRecord(value) && exact(value, ['type', 'hash', 'page', 'attempt', 'maxAttempts']) &&
    value.type === 'pdf:translation-progress' && nonEmpty(value.hash) && positiveInteger(value.page) &&
    positiveInteger(value.attempt) && (value.attempt as number) <= 3 && value.maxAttempts === 3;
}

export function isPdfMessage(value: unknown): value is PdfMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'pdf:parse-start':
      return exact(value, ['type', 'source', 'pageCount', 'consent']) &&
        isPdfSourceDescriptor(value.source) && positiveInteger(value.pageCount) &&
        (value.pageCount as number) <= 600 && typeof value.consent === 'boolean';
    case 'pdf:document-get':
    case 'pdf:translation-snapshot':
    case 'pdf:cache-clear':
      return exact(value, ['type', 'hash']) && nonEmpty(value.hash);
    case 'pdf:translate-page':
      return exact(value, ['type', 'hash', 'page']) && nonEmpty(value.hash) && positiveInteger(value.page);
    case 'pdf:history-update':
      return exact(value, ['type', 'hash', 'title', 'page', 'pageCount']) &&
        nonEmpty(value.hash) && nonEmpty(value.title) && (value.title as string).length <= 300 &&
        positiveInteger(value.page) && positiveInteger(value.pageCount) &&
        (value.page as number) <= (value.pageCount as number) && (value.pageCount as number) <= 600;
    case 'pdf:agent-ask':
      return exact(value, ['type', 'hash', 'requestId', 'activePage', 'selection', 'recentMessages', 'question', 'maxCharacters']) &&
        nonEmpty(value.hash) && nonEmpty(value.requestId) && positiveInteger(value.activePage) &&
        typeof value.selection === 'string' && nonEmpty(value.question) &&
        positiveInteger(value.maxCharacters) && (value.maxCharacters as number) <= 200_000 &&
        Array.isArray(value.recentMessages) && value.recentMessages.every((message) =>
          isRecord(message) && exact(message, ['role', 'content']) &&
          (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
    case 'pdf:agent-cancel':
    case 'pdf:cancel':
      return exact(value, ['type']);
    default:
      return false;
  }
}

function isPdfSourceDescriptor(value: unknown): value is PdfSourceDescriptor {
  return isRecord(value) &&
    exact(value, ['url', 'hash', 'title', 'size', 'kind']) &&
    nonEmpty(value.url) && nonEmpty(value.hash) && nonEmpty(value.title) &&
    Number.isSafeInteger(value.size) && (value.size as number) >= 0 &&
    (value.kind === 'remote' || value.kind === 'authenticated');
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
