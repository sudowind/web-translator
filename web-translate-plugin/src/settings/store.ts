import { defaultSettings, type ExtensionSettings } from './schema';

const settingsItem = storage.defineItem<ExtensionSettings>(
  'local:webpage-translation-settings',
  { fallback: defaultSettings },
);

export async function getSettings(): Promise<ExtensionSettings> {
  return settingsItem.getValue();
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<void> {
  await settingsItem.setValue(settings);
}
