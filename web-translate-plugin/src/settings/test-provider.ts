import { OpenAiPaperAgentClient } from '../agent/client';
import { OpenAiChatClient } from '../providers/openai/chat-client';
import { OpenAiTranslationClient } from '../providers/openai/client';
import type { LlmPurpose } from '../providers/openai/request-builder';
import { defaultSettings, type OpenAiSettings } from './schema';
import { validateProviderSettings } from './provider-access';

export interface LlmConnectionSettings {
  openAi: OpenAiSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface SettingsTestLlmMessage {
  type: 'settings:test-llm';
  purpose: LlmPurpose;
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

interface TestClients {
  createChat: (settings: OpenAiSettings) => Pick<OpenAiChatClient, 'complete'>;
  createTranslation: (settings: OpenAiSettings) => Pick<OpenAiTranslationClient, 'translate'>;
  createAgent: (settings: OpenAiSettings) => Pick<OpenAiPaperAgentClient, 'ask'>;
}

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_MODEL_LENGTH = 256;
const MAX_LANGUAGE_LENGTH = 64;

export function isSettingsTestLlmCandidate(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'settings:test-llm';
}

export function normalizeExtensionPageUrl(value: string): string {
  const url = new URL(value);
  url.pathname = `/${url.pathname.replace(/^\/+/, '')}`;
  return url.href;
}

export function isSettingsTestLlmMessage(value: unknown): value is SettingsTestLlmMessage {
  if (!hasExactKeys(value, ['type', 'purpose', 'settings'])) return false;
  if (value.type !== 'settings:test-llm' || !isPurpose(value.purpose)) return false;
  const settings = value.settings;
  if (!hasExactKeys(settings, ['openAi', 'sourceLanguage', 'targetLanguage'])) return false;
  if (typeof settings.sourceLanguage !== 'string' || typeof settings.targetLanguage !== 'string') return false;
  if (settings.sourceLanguage.length > MAX_LANGUAGE_LENGTH || settings.targetLanguage.length > MAX_LANGUAGE_LENGTH) return false;
  if (!isOpenAiShape(settings.openAi)) return false;
  try {
    normalizeLlmConnectionSettings(
      settings as unknown as LlmConnectionSettings,
      value.purpose,
    );
    return true;
  } catch {
    return false;
  }
}

export async function dispatchSettingsTestLlm(
  message: unknown,
  sender: SettingsMessageSender,
  optionsUrl: string,
  run: (settings: LlmConnectionSettings, purpose: LlmPurpose) => Promise<{ connected: true }> = testLlmConfiguration,
): Promise<TestProviderResponse> {
  const extensionId = new URL(optionsUrl).hostname;
  if (sender.id !== extensionId || sender.url !== optionsUrl) {
    return { ok: false, error: 'LLM 配置测试仅允许扩展设置页调用' };
  }
  if (!isSettingsTestLlmMessage(message)) {
    return { ok: false, error: 'LLM 配置测试消息格式无效' };
  }
  try {
    return { ok: true, value: await run(message.settings, message.purpose) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function testLlmConfiguration(
  settings: LlmConnectionSettings,
  purpose: LlmPurpose,
  clients: TestClients = {
    createChat: (value) => new OpenAiChatClient(value),
    createTranslation: (value) => new OpenAiTranslationClient(value),
    createAgent: (value) => new OpenAiPaperAgentClient(value),
  },
): Promise<{ connected: true }> {
  const validated = normalizeLlmConnectionSettings(settings, purpose);
  try {
    if (purpose === 'connection-test') {
      await clients.createChat(validated.openAi).complete({
        purpose,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      });
    } else if (purpose === 'translation') {
      await clients.createTranslation(validated.openAi).translate({
        sourceLanguage: validated.sourceLanguage,
        targetLanguage: validated.targetLanguage,
        blocks: [{ id: 'provider-connection-test', text: 'Hello' }],
      });
    } else {
      await clients.createAgent(validated.openAi).ask(
        { mode: 'full', text: '[p:1]\nHello', recentMessages: [] },
        '请回答 OK',
      );
    }
  } catch (error) {
    throw llmTestError(error, purpose, validated.openAi.dialect);
  }
  return { connected: true };
}

function normalizeLlmConnectionSettings(
  settings: LlmConnectionSettings,
  purpose: LlmPurpose,
): LlmConnectionSettings {
  const safeTranslation = {
    reasoning: { mode: 'off' as const },
    timeoutMs: 30_000,
  };
  const safeAgent = {
    inheritDefaultModel: true,
    profile: {
      model: settings.openAi.defaultModel,
      reasoning: { mode: 'auto' as const },
      timeoutMs: 120_000,
    },
  };
  const validated = validateProviderSettings({
    ...settings,
    openAi: {
      ...settings.openAi,
      translation: purpose === 'translation'
        ? settings.openAi.translation
        : safeTranslation,
      agent: purpose === 'agent' ? settings.openAi.agent : safeAgent,
    },
    mineru: defaultSettings.mineru,
  });
  return {
    openAi: validated.openAi,
    sourceLanguage: validated.sourceLanguage,
    targetLanguage: validated.targetLanguage,
  };
}

function llmTestError(
  error: unknown,
  purpose: LlmPurpose,
  dialect: OpenAiSettings['dialect'],
): Error {
  const contractCodes = new Set([
    'TRANSLATION_JSON_INVALID',
    'TRANSLATION_SCHEMA_INVALID',
    'TRANSLATION_ID_UNKNOWN',
    'TRANSLATION_ID_DUPLICATE',
    'TRANSLATION_ID_MISSING',
  ]);
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  const status = /(?:LLM|AGENT|TRANSLATION)_HTTP_(\d{3})/.exec(code)?.[1] ?? /\((\d{3})\)/.exec(message)?.[1];
  const label = purpose === 'connection-test' ? '快速连通测试' : purpose === 'translation' ? '翻译配置测试' : '智能体配置测试';
  const safeCode = code || (status ? `HTTP_${status}` : 'PROVIDER_ERROR');
  if (purpose === 'translation' && contractCodes.has(code)) {
    return new Error(
      `接口连接成功，但模型输出不符合翻译格式要求（Provider: ${dialect}；错误码: ${code}）。` +
      '请确认模型支持 JSON Object 输出，或更换适合结构化翻译的模型',
    );
  }
  if (code === 'LLM_TIMEOUT' || code === 'AGENT_TIMEOUT' || code === 'TRANSLATION_TIMEOUT') {
    return new Error(`${label}超时（Provider: ${dialect}；错误码: ${safeCode}）`);
  }
  return status
    ? new Error(`${label}失败（Provider: ${dialect}；HTTP ${status}；错误码: ${safeCode}），请检查接口地址、模型和 API Key`)
    : new Error(`${label}失败（Provider: ${dialect}；错误码: ${safeCode}），请检查接口地址、模型、思考设置和 API Key`);
}

function isPurpose(value: unknown): value is LlmPurpose {
  return value === 'connection-test' || value === 'translation' || value === 'agent';
}

function isOpenAiShape(value: unknown): boolean {
  if (!hasExactKeys(value, ['apiKey', 'baseUrl', 'dialect', 'defaultModel', 'translation', 'agent'])) return false;
  if (typeof value.apiKey !== 'string' || typeof value.baseUrl !== 'string' || typeof value.dialect !== 'string' || typeof value.defaultModel !== 'string') return false;
  if (value.apiKey.length > MAX_API_KEY_LENGTH || value.baseUrl.length > MAX_BASE_URL_LENGTH || value.defaultModel.length > MAX_MODEL_LENGTH) return false;
  if (!isTranslationProfileShape(value.translation)) return false;
  if (!hasExactKeys(value.agent, ['inheritDefaultModel', 'profile'])) return false;
  return typeof value.agent.inheritDefaultModel === 'boolean' && isProfileShape(value.agent.profile);
}

function isTranslationProfileShape(value: unknown): boolean {
  if (!hasExactKeys(value, ['reasoning', 'timeoutMs'])) return false;
  return typeof value.timeoutMs === 'number' && isReasoningShape(value.reasoning);
}

function isProfileShape(value: unknown): boolean {
  if (!hasExactKeys(value, ['model', 'reasoning', 'timeoutMs'])) return false;
  if (typeof value.model !== 'string' || value.model.length > MAX_MODEL_LENGTH || typeof value.timeoutMs !== 'number') return false;
  return typeof value.model === 'string' && value.model.length <= MAX_MODEL_LENGTH && typeof value.timeoutMs === 'number' && isReasoningShape(value.reasoning);
}

function isReasoningShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !['mode', 'effort', 'budgetTokens'].includes(key))) return false;
  return typeof (value as { mode?: unknown }).mode === 'string';
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
