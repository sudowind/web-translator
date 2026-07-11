import { defaultSettings, type TranslationSettings } from './schema';

const settingsItem = storage.defineItem<TranslationSettings>(
  'local:webpage-translation-settings',
  { fallback: defaultSettings },
);

export async function getSettings(): Promise<TranslationSettings> {
  return settingsItem.getValue();
}

export async function saveSettings(
  settings: TranslationSettings,
): Promise<void> {
  await settingsItem.setValue(settings);
}
