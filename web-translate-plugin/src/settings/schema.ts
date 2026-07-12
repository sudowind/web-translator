import type { MineruSettings } from '../providers/mineru/contracts';

export type { MineruSettings } from '../providers/mineru/contracts';

export type ProviderDialect =
  | 'openai'
  | 'dashscope'
  | 'minimax'
  | 'generic-openai';
export type ReasoningMode = 'off' | 'auto' | 'on';
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ReasoningSettings {
  mode: ReasoningMode;
  effort?: ReasoningEffort;
  budgetTokens?: number;
}

export interface ModelProfile {
  model: string;
  reasoning: ReasoningSettings;
  timeoutMs: number;
}

export interface TranslationProfile {
  reasoning: ReasoningSettings & { mode: 'off' };
  timeoutMs: number;
}

export interface OpenAiSettings {
  apiKey: string;
  baseUrl: string;
  dialect: ProviderDialect;
  defaultModel: string;
  translation: TranslationProfile;
  agent: {
    inheritDefaultModel: boolean;
    profile: ModelProfile;
  };
}

export interface ExtensionSettings {
  openAi: OpenAiSettings;
  mineru: MineruSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

export const defaultOpenAiSettings: OpenAiSettings = {
  apiKey: '',
  baseUrl: '',
  dialect: 'generic-openai',
  defaultModel: '',
  translation: {
    reasoning: { mode: 'off' },
    timeoutMs: 30_000,
  },
  agent: {
    inheritDefaultModel: true,
    profile: {
      model: '',
      reasoning: { mode: 'auto', effort: 'medium' },
      timeoutMs: 120_000,
    },
  },
};

export const defaultSettings: ExtensionSettings = {
  openAi: defaultOpenAiSettings,
  mineru: {
    baseUrl: 'https://mineru.net',
    token: '',
    modelVersion: 'vlm',
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

export function inferProviderDialect(baseUrl: string): ProviderDialect {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === 'api.openai.com') return 'openai';
    if (
      hostname.endsWith('.maas.aliyuncs.com') ||
      hostname === 'dashscope.aliyuncs.com' ||
      hostname.endsWith('.dashscope.aliyuncs.com')
    ) return 'dashscope';
    if (hostname === 'api.minimax.chat' || hostname === 'api.minimaxi.com') {
      return 'minimax';
    }
  } catch {
    // 无效 URL 由保存校验负责；迁移时使用安全通用类型。
  }
  return 'generic-openai';
}

export function resolveAgentProfile(settings: OpenAiSettings): ModelProfile {
  return settings.agent.inheritDefaultModel
    ? { ...settings.agent.profile, model: settings.defaultModel }
    : settings.agent.profile;
}
