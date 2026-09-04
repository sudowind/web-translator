import type { OpenAiSettings, TranslationOutputFormat } from './schema';

export interface TranslationCapability {
  key: string;
  format: TranslationOutputFormat;
  testedAt: number;
}

const capabilities = storage.defineItem<unknown>('local:translation-output-capabilities-v1', { fallback: [] });
export const CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let pendingWrite: Promise<unknown> = Promise.resolve();

export async function translationCapabilityKey(settings: OpenAiSettings): Promise<string> {
  const url = new URL(settings.baseUrl.trim());
  url.pathname = url.pathname.replace(/\/+$/, '');
  const identity = JSON.stringify([url.href, settings.defaultModel.trim(), settings.dialect]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validRecords(value: unknown, now: number): TranslationCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is TranslationCapability =>
    entry !== null && typeof entry === 'object' &&
    typeof entry.key === 'string' && /^[a-f0-9]{64}$/.test(entry.key) &&
    (entry.format === 'json_schema' || entry.format === 'json_object') &&
    Number.isSafeInteger(entry.testedAt) && entry.testedAt <= now && now - entry.testedAt < CAPABILITY_TTL_MS,
  ).slice(-32);
}

export async function getTranslationCapability(settings: OpenAiSettings, now = Date.now()): Promise<TranslationCapability | undefined> {
  const key = await translationCapabilityKey(settings);
  return validRecords(await capabilities.getValue(), now).find((entry) => entry.key === key);
}

export async function setTranslationCapability(settings: OpenAiSettings, format?: TranslationOutputFormat, now = Date.now()): Promise<void> {
  const key = await translationCapabilityKey(settings);
  const write = pendingWrite.catch(() => undefined).then(async () => {
    const records = validRecords(await capabilities.getValue(), now).filter((entry) => entry.key !== key);
    if (format) records.push({ key, format, testedAt: now });
    await capabilities.setValue(records.slice(-32));
  });
  pendingWrite = write;
  await write;
}

export async function resolveTranslationOutputFormat(settings: OpenAiSettings): Promise<TranslationOutputFormat> {
  const mode = settings.translation.outputMode ?? 'auto';
  if (mode !== 'auto') return mode;
  try {
    return (await getTranslationCapability(settings))?.format ?? 'json_object';
  } catch {
    // 缓存故障不阻塞正式翻译；不把未知能力误记为不支持。
    return 'json_object';
  }
}
