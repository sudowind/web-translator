import {
  defaultOpenAiSettings,
  defaultSettings,
  inferProviderDialect,
  type ExtensionSettings,
  type ModelProfile,
  type OpenAiSettings,
  type ProviderDialect,
  type ReasoningSettings,
  type TranslationProfile,
} from './schema';

const settingsItem = storage.defineItem<unknown>(
  'local:webpage-translation-settings',
  { fallback: defaultSettings },
);

export async function getSettings(): Promise<ExtensionSettings> {
  const value = await settingsItem.getValue();
  const record = isRecord(value) ? value : {};
  return {
    openAi: migrateOpenAiSettings(record.openAi),
    mineru: isRecord(record.mineru)
      ? record.mineru as unknown as ExtensionSettings['mineru']
      : defaultSettings.mineru,
    sourceLanguage: typeof record.sourceLanguage === 'string'
      ? record.sourceLanguage
      : defaultSettings.sourceLanguage,
    targetLanguage: typeof record.targetLanguage === 'string'
      ? record.targetLanguage
      : defaultSettings.targetLanguage,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await settingsItem.setValue(settings);
}

export function migrateOpenAiSettings(value: unknown): OpenAiSettings {
  const record = isRecord(value) ? value : {};
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
  const translationRecord = isRecord(record.translation) ? record.translation : {};
  const defaultModel = typeof record.defaultModel === 'string'
    ? record.defaultModel
    : typeof translationRecord.model === 'string'
      ? translationRecord.model
      : typeof record.model === 'string'
        ? record.model
        : '';
  const translation = migrateTranslationProfile(translationRecord);
  const agentRecord = isRecord(record.agent) ? record.agent : {};
  const agentProfileRecord = isRecord(agentRecord.profile) ? agentRecord.profile : {};
  return {
    apiKey,
    baseUrl,
    dialect: isDialect(record.dialect) ? record.dialect : inferProviderDialect(baseUrl),
    defaultModel,
    translation,
    agent: {
      inheritDefaultModel: typeof agentRecord.inheritDefaultModel === 'boolean'
        ? agentRecord.inheritDefaultModel
        : typeof agentRecord.inheritTranslationModel === 'boolean'
          ? agentRecord.inheritTranslationModel
          : defaultOpenAiSettings.agent.inheritDefaultModel,
      profile: migrateProfile(
        agentProfileRecord,
        defaultOpenAiSettings.agent.profile,
        defaultModel,
      ),
    },
  };
}

function migrateTranslationProfile(
  value: Record<string, unknown>,
): TranslationProfile {
  const reasoning = migrateReasoning(
    value.reasoning,
    defaultOpenAiSettings.translation.reasoning,
  );
  return {
    reasoning: { ...reasoning, mode: 'off' },
    timeoutMs: typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs)
      ? value.timeoutMs
      : defaultOpenAiSettings.translation.timeoutMs,
  };
}

function migrateProfile(
  value: Record<string, unknown>,
  fallback: ModelProfile,
  fallbackModel: string,
): ModelProfile {
  return {
    model: typeof value.model === 'string' ? value.model : fallbackModel,
    reasoning: migrateReasoning(value.reasoning, fallback.reasoning),
    timeoutMs: typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs)
      ? value.timeoutMs
      : fallback.timeoutMs,
  };
}

function migrateReasoning(value: unknown, fallback: ReasoningSettings): ReasoningSettings {
  if (!isRecord(value)) return { ...fallback };
  const mode = value.mode === 'off' || value.mode === 'auto' || value.mode === 'on'
    ? value.mode
    : fallback.mode;
  const effort = value.effort === 'low' || value.effort === 'medium' || value.effort === 'high'
    ? value.effort
    : fallback.effort;
  const budgetTokens = typeof value.budgetTokens === 'number' && Number.isSafeInteger(value.budgetTokens)
    ? value.budgetTokens
    : fallback.budgetTokens;
  return {
    mode,
    ...(effort === undefined ? {} : { effort }),
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
  };
}

function isDialect(value: unknown): value is ProviderDialect {
  return value === 'openai' || value === 'dashscope' || value === 'minimax' || value === 'generic-openai';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
