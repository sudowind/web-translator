import { describe, expect, it, vi } from 'vitest';

import {
  dispatchSettingsTestLlm,
  isSettingsTestLlmMessage,
  normalizeExtensionPageUrl,
  testLlmConfiguration,
} from '../../../src/settings/test-provider';

const settings = {
  openAi: {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    dialect: 'dashscope' as const,
    defaultModel: 'translate-model',
    translation: {
      reasoning: { mode: 'off' as const },
      timeoutMs: 30_000,
    },
    agent: {
      inheritDefaultModel: false,
      profile: {
        model: 'agent-model',
        reasoning: { mode: 'on' as const, budgetTokens: 2048 },
        timeoutMs: 120_000,
      },
    },
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('LLM 独立配置测试', () => {
  it('规范化 runtime.getURL 产生的重复路径斜杠', () => {
    expect(normalizeExtensionPageUrl('chrome-extension://extension-id//options.html')).toBe(
      'chrome-extension://extension-id/options.html',
    );
  });

  it.each(['connection-test', 'translation', 'agent'] as const)(
    '接受 %s 测试并拒绝额外字段',
    (purpose) => {
      const message = { type: 'settings:test-llm', purpose, settings };
      expect(isSettingsTestLlmMessage(message)).toBe(true);
      expect(isSettingsTestLlmMessage({ ...message, extra: true })).toBe(false);
    },
  );

  it('拒绝空凭证、未知测试目的和超长模型名', () => {
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        purpose: 'connection-test',
        settings: { ...settings, openAi: { ...settings.openAi, apiKey: '' } },
      }),
    ).toBe(false);
    expect(
      isSettingsTestLlmMessage({ type: 'settings:test-llm', purpose: 'unknown', settings }),
    ).toBe(false);
    expect(
      isSettingsTestLlmMessage({
        type: 'settings:test-llm',
        purpose: 'translation',
        settings: {
          ...settings,
          openAi: {
            ...settings.openAi,
            defaultModel: 'x'.repeat(257),
          },
        },
      }),
    ).toBe(false);
  });

  it('快速、翻译和智能体测试分别调用对应最小探针', async () => {
    const complete = vi.fn().mockResolvedValue('OK');
    const translate = vi.fn().mockResolvedValue([{ id: 'provider-connection-test', text: '你好' }]);
    const ask = vi.fn().mockResolvedValue('OK');
    const clients = {
      createChat: () => ({ complete }),
      createTranslation: () => ({ translate }),
      createAgent: () => ({ ask }),
    };

    await testLlmConfiguration(settings, 'connection-test', clients);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'connection-test' }));
    await testLlmConfiguration(settings, 'translation', clients);
    expect(translate).toHaveBeenCalledWith(expect.objectContaining({
      blocks: [{ id: 'provider-connection-test', text: 'Hello' }],
    }));
    await testLlmConfiguration(settings, 'agent', clients);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '[p:1]\nHello' }), '请回答 OK');
  });

  it('快速连通和翻译测试不被未完成的智能体配置阻塞', async () => {
    const incompleteAgent = {
      ...settings,
      openAi: {
        ...settings.openAi,
        agent: {
          inheritDefaultModel: false,
          profile: { ...settings.openAi.agent.profile, model: '' },
        },
      },
    };
    const complete = vi.fn().mockResolvedValue('OK');
    const translate = vi.fn().mockResolvedValue([{ id: 'provider-connection-test', text: '你好' }]);
    const clients = {
      createChat: () => ({ complete }),
      createTranslation: () => ({ translate }),
      createAgent: () => ({ ask: vi.fn() }),
    };

    await expect(testLlmConfiguration(incompleteAgent, 'connection-test', clients)).resolves.toEqual({ connected: true });
    await expect(testLlmConfiguration(incompleteAgent, 'translation', clients)).resolves.toEqual({ connected: true });
  });

  it('后台仅允许精确 options 页面调用', async () => {
    const run = vi.fn().mockResolvedValue({ connected: true });
    const message = { type: 'settings:test-llm', purpose: 'agent', settings };
    const optionsUrl = 'chrome-extension://extension-id/options.html';

    await expect(
      dispatchSettingsTestLlm(message, { id: 'extension-id', url: optionsUrl }, optionsUrl, run),
    ).resolves.toEqual({ ok: true, value: { connected: true } });
    expect(run).toHaveBeenCalledWith(settings, 'agent');

    await expect(
      dispatchSettingsTestLlm(
        message,
        { id: 'extension-id', url: 'https://article.example.test/story' },
        optionsUrl,
        run,
      ),
    ).resolves.toEqual({ ok: false, error: 'LLM 配置测试仅允许扩展设置页调用' });
  });
});
