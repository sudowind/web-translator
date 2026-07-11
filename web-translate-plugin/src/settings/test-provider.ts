import { OpenAiTranslationClient } from '../providers/openai/client';
import type { ExtensionSettings } from './schema';
import { validateProviderSettings } from './provider-access';

export interface SettingsTestProviderMessage {
  type: 'settings:test-provider';
  settings: ExtensionSettings;
}

interface SettingsMessageSender {
  id?: string;
  tab?: { id?: number };
  url?: string;
}

type TestProviderResponse =
  | { ok: true; value: { connected: true } }
  | { ok: false; error: string };

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_MODEL_LENGTH = 256;
const MAX_LANGUAGE_LENGTH = 64;

export function isSettingsTestProviderCandidate(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'settings:test-provider'
  );
}

export function normalizeExtensionPageUrl(value: string): string {
  const url = new URL(value);
  url.pathname = `/${url.pathname.replace(/^\/+/, '')}`;
  return url.href;
}

export function isSettingsTestProviderMessage(
  value: unknown,
): value is SettingsTestProviderMessage {
  if (!hasExactKeys(value, ['type', 'settings'])) return false;
  if (value.type !== 'settings:test-provider') return false;
  const settings = value.settings;
  if (
    !hasExactKeys(settings, [
      'openAi',
      'mineru',
      'sourceLanguage',
      'targetLanguage',
    ]) ||
    !hasExactKeys(settings.openAi, ['apiKey', 'baseUrl', 'model']) ||
    !hasExactKeys(settings.mineru, ['baseUrl', 'token', 'modelVersion']) ||
    typeof settings.openAi.apiKey !== 'string' ||
    typeof settings.openAi.baseUrl !== 'string' ||
    typeof settings.openAi.model !== 'string' ||
    typeof settings.mineru.baseUrl !== 'string' ||
    typeof settings.mineru.token !== 'string' ||
    typeof settings.mineru.modelVersion !== 'string' ||
    typeof settings.sourceLanguage !== 'string' ||
    typeof settings.targetLanguage !== 'string' ||
    settings.openAi.baseUrl.length > MAX_BASE_URL_LENGTH ||
    settings.openAi.apiKey.length > MAX_API_KEY_LENGTH ||
    settings.openAi.model.length > MAX_MODEL_LENGTH ||
    settings.mineru.baseUrl.length > MAX_BASE_URL_LENGTH ||
    settings.mineru.token.length > MAX_API_KEY_LENGTH ||
    settings.mineru.modelVersion.length > MAX_MODEL_LENGTH ||
    settings.sourceLanguage.length > MAX_LANGUAGE_LENGTH ||
    settings.targetLanguage.length > MAX_LANGUAGE_LENGTH
  ) {
    return false;
  }
  try {
    validateProviderSettings(settings as unknown as ExtensionSettings);
    return true;
  } catch {
    return false;
  }
}

export async function dispatchSettingsTestProvider(
  message: unknown,
  sender: SettingsMessageSender,
  optionsUrl: string,
  run: (settings: ExtensionSettings) => Promise<{ connected: true }> =
    testProviderConnection,
): Promise<TestProviderResponse> {
  const extensionId = new URL(optionsUrl).hostname;
  if (sender.id !== extensionId || sender.url !== optionsUrl) {
    return {
      ok: false,
      error: 'Provider 连接测试仅允许扩展设置页调用',
    };
  }
  if (!isSettingsTestProviderMessage(message)) {
    return { ok: false, error: 'Provider 连接测试消息格式无效' };
  }
  try {
    return { ok: true, value: await run(message.settings) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testProviderConnection(
  settings: ExtensionSettings,
  createClient: (
    value: ExtensionSettings['openAi'],
  ) => Pick<OpenAiTranslationClient, 'translate'> = (value) =>
    new OpenAiTranslationClient(value),
): Promise<{ connected: true }> {
  const validated = validateProviderSettings(settings);
  await createClient(validated.openAi).translate({
    sourceLanguage: validated.sourceLanguage,
    targetLanguage: validated.targetLanguage,
    blocks: [{ id: 'provider-connection-test', text: 'Hello' }],
  });
  return { connected: true };
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
