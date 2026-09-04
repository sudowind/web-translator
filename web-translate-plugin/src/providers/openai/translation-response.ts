import type { TranslationResult } from './contracts';

export class TranslationProviderError extends Error {
  override readonly name = 'TranslationProviderError';

  constructor(readonly code: string) {
    super(code);
  }
}

export function parseTranslationResponse(
  content: string,
  expectedIds: readonly string[],
): TranslationResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonFence(content));
  } catch {
    throw new TranslationProviderError('TRANSLATION_JSON_INVALID');
  }

  const translations = readTranslations(parsed);
  const expected = new Set(expectedIds);
  const resultById = new Map<string, TranslationResult>();
  for (const translation of translations) {
    if (!expected.has(translation.id)) {
      throw new TranslationProviderError('TRANSLATION_ID_UNKNOWN');
    }
    if (resultById.has(translation.id)) {
      throw new TranslationProviderError('TRANSLATION_ID_DUPLICATE');
    }
    resultById.set(translation.id, translation);
  }
  if (resultById.size !== expected.size) {
    throw new TranslationProviderError('TRANSLATION_ID_MISSING');
  }
  return expectedIds.map((id) => resultById.get(id)!);
}

function unwrapJsonFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function readTranslations(value: unknown): TranslationResult[] {
  if (typeof value !== 'object' || value === null) {
    throw new TranslationProviderError('TRANSLATION_SCHEMA_INVALID');
  }
  const record = value as { translations?: unknown; blocks?: unknown };
  const hasTranslations = Object.prototype.hasOwnProperty.call(record, 'translations');
  const hasBlocks = Object.prototype.hasOwnProperty.call(record, 'blocks');
  if (hasTranslations === hasBlocks) {
    throw new TranslationProviderError('TRANSLATION_SCHEMA_INVALID');
  }
  const translations = hasTranslations ? record.translations : record.blocks;
  if (!Array.isArray(translations) || !translations.every(isTranslationResult)) {
    throw new TranslationProviderError('TRANSLATION_SCHEMA_INVALID');
  }
  return translations;
}

function isTranslationResult(value: unknown): value is TranslationResult {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as TranslationResult).id === 'string' &&
    typeof (value as TranslationResult).text === 'string';
}
