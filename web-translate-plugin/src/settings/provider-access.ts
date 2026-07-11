import { defaultSettings, type ExtensionSettings } from './schema';

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

export function validateProviderSettings(
  settings: ExtensionSettings,
): ExtensionSettings {
  const apiKey = settings.openAi.apiKey.trim();
  const model = settings.openAi.model.trim();
  const sourceLanguage = settings.sourceLanguage.trim();
  const targetLanguage = settings.targetLanguage.trim();
  if (!apiKey) throw new Error('API Key 不能为空，请填写后重试');
  if (!model) throw new Error('模型不能为空，请填写后重试');
  if (!sourceLanguage || !targetLanguage) {
    throw new Error('源语言和目标语言不能为空');
  }
  providerOriginPattern(settings.openAi.baseUrl);
  const baseUrl = settings.openAi.baseUrl.trim().replace(/\/+$/, '');
  const token = settings.mineru.token.trim();
  let mineru = defaultSettings.mineru;
  if (token) {
    if (settings.mineru.modelVersion !== 'vlm' && settings.mineru.modelVersion !== 'pipeline') {
      throw new Error('MinerU 模型版本无效');
    }
    providerOriginPattern(settings.mineru.baseUrl);
    mineru = {
      baseUrl: settings.mineru.baseUrl.trim().replace(/\/+$/, ''),
      token,
      modelVersion: settings.mineru.modelVersion,
    };
  }
  return {
    openAi: { apiKey, baseUrl, model },
    mineru,
    sourceLanguage,
    targetLanguage,
  };
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
