import { defaultSettings, type ExtensionSettings } from './schema';

const settingsItem = storage.defineItem<ExtensionSettings>(
  'local:webpage-translation-settings',
  { fallback: defaultSettings },
);

export async function getSettings(): Promise<ExtensionSettings> {
  const value = await settingsItem.getValue();
  return {
    ...value,
    mineru: value.mineru ?? defaultSettings.mineru,
  };
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<void> {
  await settingsItem.setValue(settings);
}
