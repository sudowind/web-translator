import { OpenAiTranslationClient } from '../providers/openai/client';
import type { ExtensionSettings } from './schema';
import { validateProviderSettings } from './provider-access';

export interface SettingsTestProviderMessage {
  type: 'settings:test-provider';
  settings: ExtensionSettings;
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
      'sourceLanguage',
      'targetLanguage',
    ]) ||
    !hasExactKeys(settings.openAi, ['apiKey', 'baseUrl', 'model']) ||
    typeof settings.openAi.apiKey !== 'string' ||
    typeof settings.openAi.baseUrl !== 'string' ||
    typeof settings.openAi.model !== 'string' ||
    typeof settings.sourceLanguage !== 'string' ||
    typeof settings.targetLanguage !== 'string'
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
