import { describe, expect, it, vi } from 'vitest';

import type { OpenAiTranslationClient } from '../../../src/providers/openai/client';
import {
  dispatchSettingsTestLlm,
  isSettingsTestLlmMessage,
  normalizeExtensionPageUrl,
  testLlmConnection,
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

describe('LLM 连接测试', () => {
  it('规范化 runtime.getURL 产生的重复路径斜杠', () => {
    expect(
      normalizeExtensionPageUrl('chrome-extension://extension-id//options.html'),
    ).toBe('chrome-extension://extension-id/options.html');
  });
  it('只接受不携带 MinerU 配置的精确 LLM 测试消息', () => {
    expect(
      isSettingsTestLlmMessage({ type: 'settings:test-llm', settings }),
    ).toBe(true);
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        settings,
        extra: true,
      }),
    ).toBe(false);
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        settings: { ...settings, openAi: { ...settings.openAi, apiKey: '' } },
      }),
    ).toBe(false);
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        settings: { ...settings, mineru: { token: 'should-not-be-here' } },
      }),
    ).toBe(false);
  });

  it('使用临时表单设置执行最小翻译探测', async () => {
    const translate = vi.fn().mockResolvedValue([
      { id: 'provider-connection-test', text: '连接成功' },
    ]);

    await expect(
      testLlmConnection(
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

  it('把 HTTP 失败明确归属到 LLM', async () => {
    const translate = vi
      .fn()
      .mockRejectedValue(new Error('翻译请求失败 (404)'));

    await expect(
      testLlmConnection(
        settings,
        () => ({ translate }) as unknown as OpenAiTranslationClient,
      ),
    ).rejects.toThrow(
      'LLM 请求失败（HTTP 404），请检查接口地址、模型和 API Key',
    );
  });

  it.each([
    ['baseUrl', { ...settings.openAi, baseUrl: `https://example.test/${'x'.repeat(2049)}` }],
    ['apiKey', { ...settings.openAi, apiKey: 'x'.repeat(4097) }],
    ['model', { ...settings.openAi, model: 'x'.repeat(257) }],
  ])('拒绝超长 %s', (_field, openAi) => {
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        settings: { ...settings, openAi },
      }),
    ).toBe(false);
  });

  it('后台允许精确 options 标签页并拒绝网页 sender', async () => {
    const run = vi.fn().mockResolvedValue({ connected: true });
    const message = { type: 'settings:test-llm', settings };
    const optionsUrl = 'chrome-extension://extension-id/options.html';

    await expect(
      dispatchSettingsTestLlm(
        message,
        { id: 'extension-id', url: optionsUrl, tab: { id: 7 } },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: true, value: { connected: true } });
    expect(run).toHaveBeenCalledOnce();

    await expect(
      dispatchSettingsTestLlm(
        message,
        {
          id: 'extension-id',
          url: 'https://article.example.test/story',
          tab: { id: 7 },
        },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: false, error: 'LLM 连接测试仅允许扩展设置页调用' });
    await expect(
      dispatchSettingsTestLlm(
        message,
        {
          id: 'other-extension',
          url: optionsUrl,
          tab: { id: 8 },
        },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: false, error: 'LLM 连接测试仅允许扩展设置页调用' });
    expect(run).toHaveBeenCalledOnce();
  });
});
