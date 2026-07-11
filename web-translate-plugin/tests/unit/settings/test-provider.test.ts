import { describe, expect, it, vi } from 'vitest';

import type { OpenAiTranslationClient } from '../../../src/providers/openai/client';
import {
  isSettingsTestProviderMessage,
  testProviderConnection,
} from '../../../src/settings/test-provider';

const settings = {
  openAi: {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    model: 'translate-model',
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('Provider 连接测试', () => {
  it('只接受精确的设置测试消息', () => {
    expect(
      isSettingsTestProviderMessage({ type: 'settings:test-provider', settings }),
    ).toBe(true);
    expect(
      isSettingsTestProviderMessage({
        type: 'settings:test-provider',
        settings,
        extra: true,
      }),
    ).toBe(false);
    expect(
      isSettingsTestProviderMessage({
        type: 'settings:test-provider',
        settings: { ...settings, openAi: { ...settings.openAi, apiKey: '' } },
      }),
    ).toBe(false);
  });

  it('使用临时表单设置执行最小翻译探测', async () => {
    const translate = vi.fn().mockResolvedValue([
      { id: 'provider-connection-test', text: '连接成功' },
    ]);

    await expect(
      testProviderConnection(
        settings,
        () => ({ translate }) as unknown as OpenAiTranslationClient,
      ),
    ).resolves.toEqual({ connected: true });
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      blocks: [{ id: 'provider-connection-test', text: 'Hello' }],
    });
  });
});
