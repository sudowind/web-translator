import {
  defaultSettings,
  type ExtensionSettings,
  type MineruSettings,
  type ModelProfile,
  type OpenAiSettings,
  type ProviderDialect,
} from './schema';

type PermissionRequester = (permissions: {
  origins: string[];
}) => Promise<boolean>;

export function providerOriginPattern(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error('接口地址必须是有效 HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('接口地址必须使用 HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('接口地址不得包含用户凭据');
  }
  return `${url.origin}/*`;
}

export function normalizeMineruBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('MinerU 接口地址必须是有效 HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('MinerU 接口地址必须使用 HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('MinerU 接口地址不得包含用户凭据');
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(
      'MinerU 接口地址必须填写 API 根地址，例如 https://mineru.net',
    );
  }
  return url.origin;
}

export async function checkMineruConfiguration(
  settings: MineruSettings,
  requestPermission: PermissionRequester,
): Promise<MineruSettings> {
  const token = settings.token.trim();
  if (!token) throw new Error('MinerU Token 不能为空');
  if (settings.modelVersion !== 'vlm' && settings.modelVersion !== 'pipeline') {
    throw new Error('MinerU 模型版本无效');
  }
  const baseUrl = normalizeMineruBaseUrl(settings.baseUrl);
  const granted = await requestPermission({
    origins: [providerOriginPattern(baseUrl)],
  });
  if (!granted) throw new Error('未获得 MinerU Origin 授权');
  return { baseUrl, token, modelVersion: settings.modelVersion };
}

export function validateProviderSettings(
  settings: ExtensionSettings,
): ExtensionSettings {
  const apiKey = settings.openAi.apiKey.trim();
  const sourceLanguage = settings.sourceLanguage.trim();
  const targetLanguage = settings.targetLanguage.trim();
  if (!apiKey) throw new Error('API Key 不能为空，请填写后重试');
  if (!sourceLanguage || !targetLanguage) {
    throw new Error('源语言和目标语言不能为空');
  }
  providerOriginPattern(settings.openAi.baseUrl);
  const baseUrl = settings.openAi.baseUrl.trim().replace(/\/+$/, '');
  const dialect = normalizeDialect(settings.openAi.dialect);
  const translation = normalizeProfile(
    settings.openAi.translation,
    'translation',
    dialect,
  );
  const inheritTranslationModel = Boolean(
    settings.openAi.agent.inheritTranslationModel,
  );
  const agentProfile = normalizeProfile(
    inheritTranslationModel
      ? { ...settings.openAi.agent.profile, model: translation.model }
      : settings.openAi.agent.profile,
    'agent',
    dialect,
  );
  const token = settings.mineru.token.trim();
  let mineru = defaultSettings.mineru;
  if (token) {
    if (settings.mineru.modelVersion !== 'vlm' && settings.mineru.modelVersion !== 'pipeline') {
      throw new Error('MinerU 模型版本无效');
    }
    const mineruBaseUrl = normalizeMineruBaseUrl(settings.mineru.baseUrl);
    mineru = {
      baseUrl: mineruBaseUrl,
      token,
      modelVersion: settings.mineru.modelVersion,
    };
  }
  return {
    openAi: {
      apiKey,
      baseUrl,
      dialect,
      translation,
      agent: {
        inheritTranslationModel,
        profile: agentProfile,
      },
    },
    mineru,
    sourceLanguage,
    targetLanguage,
  };
}

function normalizeDialect(value: ProviderDialect): ProviderDialect {
  if (
    value === 'openai' || value === 'dashscope' || value === 'minimax' ||
    value === 'generic-openai'
  ) return value;
  throw new Error('Provider 类型无效');
}

function normalizeProfile(
  profile: ModelProfile,
  purpose: 'translation' | 'agent',
  dialect: ProviderDialect,
): ModelProfile {
  const model = profile.model.trim();
  if (!model) throw new Error(`${purpose === 'translation' ? '翻译' : '问答'}模型不能为空`);
  const min = purpose === 'translation' ? 5_000 : 15_000;
  const max = purpose === 'translation' ? 120_000 : 300_000;
  if (!Number.isSafeInteger(profile.timeoutMs) || profile.timeoutMs < min || profile.timeoutMs > max) {
    throw new Error(`${purpose === 'translation' ? '翻译' : '问答'}超时范围无效`);
  }
  const reasoning = { ...profile.reasoning };
  if (purpose === 'translation' && reasoning.mode !== 'off') {
    throw new Error('翻译结构化输出必须关闭思考模式');
  }
  if (!['off', 'auto', 'on'].includes(reasoning.mode)) {
    throw new Error('思考模式无效');
  }
  if (dialect === 'generic-openai' && reasoning.mode === 'on') {
    throw new Error('通用 OpenAI 兼容接口无法确认思考协议');
  }
  if (dialect === 'minimax' && reasoning.mode === 'on') {
    throw new Error('MiniMax 仅支持关闭或自动思考');
  }
  if (reasoning.budgetTokens !== undefined &&
    (!Number.isSafeInteger(reasoning.budgetTokens) || reasoning.budgetTokens < 1 || reasoning.budgetTokens > 131_072)) {
    throw new Error('思考 Token 上限无效');
  }
  if (dialect === 'openai' && reasoning.mode === 'on' &&
    !['low', 'medium', 'high'].includes(reasoning.effort ?? '')) {
    throw new Error('OpenAI 思考强度无效');
  }
  return { model, reasoning, timeoutMs: profile.timeoutMs };
}

export async function authorizeProviderSettings(
  settings: ExtensionSettings,
  requestPermission: PermissionRequester,
): Promise<ExtensionSettings> {
  const validated = validateProviderSettings(settings);
  const origins = [providerOriginPattern(validated.openAi.baseUrl)];
  if (validated.mineru.token) {
    origins.push(providerOriginPattern(validated.mineru.baseUrl));
  }
  const granted = await requestPermission({ origins });
  if (!granted) {
    throw new Error('未获得 Provider Origin 授权；请授权后重试');
  }
  return validated;
}
