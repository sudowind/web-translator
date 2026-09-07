import type { TranslationBlockInput } from '../providers/openai/contracts';

const MAX_BATCH_SIZE = 20;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 10_000;
const MAX_SESSION_ID_LENGTH = 128;

export interface TranslationBlocksMessage {
  type: 'translation:blocks';
  sessionId: string;
  blocks: TranslationBlockInput[];
}

export interface TranslationCancelMessage {
  type: 'translation:cancel';
  sessionId: string;
}

export type WebpageBackgroundMessage =
  | { type: 'translation:clear-cache'; sessionId: string }
  | TranslationBlocksMessage
  | TranslationCancelMessage;

export function isTranslationBlocksMessage(
  value: unknown,
): value is TranslationBlocksMessage {
  if (!hasExactKeys(value, ['type', 'sessionId', 'blocks'])) return false;
  if (value.type !== 'translation:blocks' || !isSessionId(value.sessionId)) {
    return false;
  }
  if (
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0 ||
    value.blocks.length > MAX_BATCH_SIZE
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const block of value.blocks) {
    if (!hasExactKeys(block, ['id', 'text'])) return false;
    if (
      typeof block.id !== 'string' ||
      block.id.length === 0 ||
      block.id.length > MAX_ID_LENGTH ||
      ids.has(block.id) ||
      typeof block.text !== 'string' ||
      block.text.trim().length === 0 ||
      block.text.length > MAX_TEXT_LENGTH
    ) {
      return false;
    }
    ids.add(block.id);
  }
  return true;
}

export function isTranslationCancelMessage(
  value: unknown,
): value is TranslationCancelMessage {
  return (
    hasExactKeys(value, ['type', 'sessionId']) &&
    value.type === 'translation:cancel' &&
    isSessionId(value.sessionId)
  );
}

export function isWebpageBackgroundMessage(
  value: unknown,
): value is WebpageBackgroundMessage {
  return isTranslationBlocksMessage(value) || isTranslationCancelMessage(value) || isTranslationClearCacheMessage(value);
}

export function isTranslationClearCacheMessage(value: unknown): value is Extract<WebpageBackgroundMessage, {type: 'translation:clear-cache'}> {
  return hasExactKeys(value, ['type', 'sessionId']) && value.type === 'translation:clear-cache' && isSessionId(value.sessionId);
}

export interface WebpageProgressEvent {
  type: 'translation:progress';
  sessionId: string;
  batchId: string;
  result?: { id: string; text: string };
  cached?: boolean;
  invalid?: boolean;
  timing?: { ttftMs?: number; durationMs: number };
}
export function isWebpageProgressEvent(value: unknown): value is WebpageProgressEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as WebpageProgressEvent;
  const time = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return v.type === 'translation:progress' && isSessionId(v.sessionId) && isSessionId(v.batchId) &&
    (v.cached === undefined || typeof v.cached === 'boolean') && (v.invalid === undefined || typeof v.invalid === 'boolean') &&
    (v.result === undefined || (isSessionId(v.result?.id) && typeof v.result.text === 'string' && v.result.text.length <= 100_000)) &&
    (v.timing === undefined || (time(v.timing?.durationMs) && (v.timing.ttftMs === undefined || time(v.timing.ttftMs))));
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH
  );
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
