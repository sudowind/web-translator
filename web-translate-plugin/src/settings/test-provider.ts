import { OpenAiTranslationClient } from '../providers/openai/client';
import type { OpenAiSettings } from './schema';
import { providerOriginPattern } from './provider-access';

export interface LlmConnectionSettings {
  openAi: OpenAiSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface SettingsTestLlmMessage {
  type: 'settings:test-llm';
  settings: LlmConnectionSettings;
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

export function isSettingsTestLlmCandidate(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'settings:test-llm'
  );
}

export function normalizeExtensionPageUrl(value: string): string {
  const url = new URL(value);
  url.pathname = `/${url.pathname.replace(/^\/+/, '')}`;
  return url.href;
}

export function isSettingsTestLlmMessage(
  value: unknown,
): value is SettingsTestLlmMessage {
  if (!hasExactKeys(value, ['type', 'settings'])) return false;
  if (value.type !== 'settings:test-llm') return false;
  const settings = value.settings;
  if (
    !hasExactKeys(settings, ['openAi', 'sourceLanguage', 'targetLanguage']) ||
    !hasExactKeys(settings.openAi, ['apiKey', 'baseUrl', 'model']) ||
    typeof settings.openAi.apiKey !== 'string' ||
    typeof settings.openAi.baseUrl !== 'string' ||
    typeof settings.openAi.model !== 'string' ||
    typeof settings.sourceLanguage !== 'string' ||
    typeof settings.targetLanguage !== 'string' ||
    settings.openAi.baseUrl.length > MAX_BASE_URL_LENGTH ||
    settings.openAi.apiKey.length > MAX_API_KEY_LENGTH ||
    settings.openAi.model.length > MAX_MODEL_LENGTH ||
    settings.sourceLanguage.length > MAX_LANGUAGE_LENGTH ||
    settings.targetLanguage.length > MAX_LANGUAGE_LENGTH
  ) {
    return false;
  }
  try {
    normalizeLlmConnectionSettings(settings as unknown as LlmConnectionSettings);
    return true;
  } catch {
    return false;
  }
}

export async function dispatchSettingsTestLlm(
  message: unknown,
  sender: SettingsMessageSender,
  optionsUrl: string,
  run: (settings: LlmConnectionSettings) => Promise<{ connected: true }> =
    testLlmConnection,
): Promise<TestProviderResponse> {
  const extensionId = new URL(optionsUrl).hostname;
  if (sender.id !== extensionId || sender.url !== optionsUrl) {
    return {
      ok: false,
      error: 'LLM 连接测试仅允许扩展设置页调用',
    };
  }
  if (!isSettingsTestLlmMessage(message)) {
    return { ok: false, error: 'LLM 连接测试消息格式无效' };
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

export async function testLlmConnection(
  settings: LlmConnectionSettings,
  createClient: (
    value: OpenAiSettings,
  ) => Pick<OpenAiTranslationClient, 'translate'> = (value) =>
    new OpenAiTranslationClient(value),
): Promise<{ connected: true }> {
  const validated = normalizeLlmConnectionSettings(settings);
  try {
    await createClient(validated.openAi).translate({
      sourceLanguage: validated.sourceLanguage,
      targetLanguage: validated.targetLanguage,
      blocks: [{ id: 'provider-connection-test', text: 'Hello' }],
    });
  } catch (error) {
    throw llmConnectionError(error);
  }
  return { connected: true };
}

function normalizeLlmConnectionSettings(
  settings: LlmConnectionSettings,
): LlmConnectionSettings {
  const apiKey = settings.openAi.apiKey.trim();
  const model = settings.openAi.model.trim();
  const sourceLanguage = settings.sourceLanguage.trim();
  const targetLanguage = settings.targetLanguage.trim();
  if (!apiKey) throw new Error('LLM API Key 不能为空');
  if (!model) throw new Error('LLM 模型不能为空');
  if (!sourceLanguage || !targetLanguage) {
    throw new Error('源语言和目标语言不能为空');
  }
  providerOriginPattern(settings.openAi.baseUrl);
  return {
    openAi: {
      apiKey,
      model,
      baseUrl: settings.openAi.baseUrl.trim().replace(/\/+$/, ''),
    },
    sourceLanguage,
    targetLanguage,
  };
}

function llmConnectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  const status = /\((\d{3})\)/.exec(message)?.[1];
  return status
    ? new Error(
        `LLM 请求失败（HTTP ${status}），请检查接口地址、模型和 API Key`,
      )
    : new Error('LLM 连接失败，请检查接口地址、模型和 API Key');
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
