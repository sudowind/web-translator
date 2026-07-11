import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { getSettings, saveSettings } from '../../../src/settings/store';
import type {
  ExtensionSettings,
  OpenAiSettings,
} from '../../../src/settings/schema';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('网页翻译设置', () => {
  it('从 local 存储返回默认语言并完整保存配置', async () => {
    await expect(getSettings()).resolves.toEqual({
      openAi: {
        apiKey: '',
        baseUrl: '',
        model: '',
      },
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    });

    const openAi = {
      apiKey: 'secret-key',
      baseUrl: 'https://llm.example/v1',
      model: 'translator',
    } satisfies OpenAiSettings;
    const settings = {
      openAi,
      sourceLanguage: 'fr',
      targetLanguage: 'zh-TW',
    } satisfies ExtensionSettings;
    await saveSettings(settings);

    await expect(getSettings()).resolves.toEqual(settings);
    await expect(
      fakeBrowser.storage.local.get('webpage-translation-settings'),
    ).resolves.toEqual({ 'webpage-translation-settings': settings });
    await expect(
      fakeBrowser.storage.sync.get('webpage-translation-settings'),
    ).resolves.toEqual({});
  });
});
