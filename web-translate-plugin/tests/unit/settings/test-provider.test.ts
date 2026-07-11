import { describe, expect, it, vi } from 'vitest';

import type { OpenAiTranslationClient } from '../../../src/providers/openai/client';
import {
  dispatchSettingsTestProvider,
  isSettingsTestProviderMessage,
  normalizeExtensionPageUrl,
  testProviderConnection,
} from '../../../src/settings/test-provider';

const settings = {
  openAi: {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    model: 'translate-model',
  },
  mineru: {
    baseUrl: 'https://mineru.net',
    token: '',
    modelVersion: 'vlm' as const,
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('Provider 连接测试', () => {
  it('规范化 runtime.getURL 产生的重复路径斜杠', () => {
    expect(
      normalizeExtensionPageUrl('chrome-extension://extension-id//options.html'),
    ).toBe('chrome-extension://extension-id/options.html');
  });
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

  it.each([
    ['baseUrl', { ...settings.openAi, baseUrl: `https://example.test/${'x'.repeat(2049)}` }],
    ['apiKey', { ...settings.openAi, apiKey: 'x'.repeat(4097) }],
    ['model', { ...settings.openAi, model: 'x'.repeat(257) }],
  ])('拒绝超长 %s', (_field, openAi) => {
    expect(
      isSettingsTestProviderMessage({
        type: 'settings:test-provider',
        settings: { ...settings, openAi },
      }),
    ).toBe(false);
  });

  it('后台允许精确 options 标签页并拒绝网页 sender', async () => {
    const run = vi.fn().mockResolvedValue({ connected: true });
    const message = { type: 'settings:test-provider', settings };
    const optionsUrl = 'chrome-extension://extension-id/options.html';

    await expect(
      dispatchSettingsTestProvider(
        message,
        { id: 'extension-id', url: optionsUrl, tab: { id: 7 } },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: true, value: { connected: true } });
    expect(run).toHaveBeenCalledOnce();

    await expect(
      dispatchSettingsTestProvider(
        message,
        {
          id: 'extension-id',
          url: 'https://article.example.test/story',
          tab: { id: 7 },
        },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: false, error: 'Provider 连接测试仅允许扩展设置页调用' });
    await expect(
      dispatchSettingsTestProvider(
        message,
        {
          id: 'other-extension',
          url: optionsUrl,
          tab: { id: 8 },
        },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: false, error: 'Provider 连接测试仅允许扩展设置页调用' });
    expect(run).toHaveBeenCalledOnce();
  });
});
