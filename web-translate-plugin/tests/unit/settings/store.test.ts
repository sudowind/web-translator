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
        dialect: 'generic-openai',
        defaultModel: '',
        translation: {
          reasoning: { mode: 'off' },
          timeoutMs: 30_000,
        },
        agent: {
          inheritDefaultModel: true,
          profile: {
            model: '',
            reasoning: { mode: 'auto', effort: 'medium' },
            timeoutMs: 120_000,
          },
        },
      },
      mineru: {
        baseUrl: 'https://mineru.net',
        token: '',
        modelVersion: 'vlm',
      },
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    });

    const openAi = {
      apiKey: 'secret-key',
      baseUrl: 'https://llm.example/v1',
      dialect: 'generic-openai' as const,
      defaultModel: 'translator',
      translation: {
        reasoning: { mode: 'off' as const },
        timeoutMs: 30_000,
      },
      agent: {
        inheritDefaultModel: true,
        profile: {
          model: 'translator',
          reasoning: { mode: 'auto' as const, effort: 'medium' as const },
          timeoutMs: 120_000,
        },
      },
    } satisfies OpenAiSettings;
    const settings = {
      openAi,
      mineru: {
        baseUrl: 'https://mineru.example.test',
        token: 'mineru-secret',
        modelVersion: 'pipeline' as const,
      },
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

  it('读取旧设置时补齐 MinerU 默认配置', async () => {
    await fakeBrowser.storage.local.set({
      'webpage-translation-settings': {
        openAi: { apiKey: 'key', baseUrl: 'https://api.example.test/v1', model: 'm' },
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      },
    });
    await expect(getSettings()).resolves.toMatchObject({
      openAi: {
        apiKey: 'key',
        baseUrl: 'https://api.example.test/v1',
        dialect: 'generic-openai',
        defaultModel: 'm',
        translation: {
          reasoning: { mode: 'off' },
          timeoutMs: 30_000,
        },
        agent: {
          inheritDefaultModel: true,
          profile: {
            model: 'm',
            reasoning: { mode: 'auto', effort: 'medium' },
            timeoutMs: 120_000,
          },
        },
      },
      mineru: { baseUrl: 'https://mineru.net', token: '', modelVersion: 'vlm' },
    });
  });

  it('从百炼旧 Endpoint 推断 Provider 类型', async () => {
    await fakeBrowser.storage.local.set({
      'webpage-translation-settings': {
        openAi: {
          apiKey: 'key',
          baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
          model: 'qwen-plus',
        },
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      },
    });
    await expect(getSettings()).resolves.toMatchObject({
      openAi: {
        dialect: 'dashscope',
        defaultModel: 'qwen-plus',
        agent: { inheritDefaultModel: true },
      },
    });
  });

  it('逐字段修复部分损坏的新结构', async () => {
    await fakeBrowser.storage.local.set({
      'webpage-translation-settings': {
        openAi: {
          apiKey: 'key',
          baseUrl: 'https://api.openai.com/v1',
          dialect: 'broken',
          translation: { model: 'gpt-test', reasoning: {}, timeoutMs: 'bad' },
          agent: { inheritTranslationModel: 'yes', profile: {} },
        },
      },
    });
    await expect(getSettings()).resolves.toMatchObject({
      openAi: {
        dialect: 'openai',
        defaultModel: 'gpt-test',
        translation: {
          reasoning: { mode: 'off' },
          timeoutMs: 30_000,
        },
        agent: {
          inheritDefaultModel: true,
          profile: {
            model: 'gpt-test',
            reasoning: { mode: 'auto', effort: 'medium' },
            timeoutMs: 120_000,
          },
        },
      },
    });
  });

  it('把当前双任务结构迁移为默认模型结构', async () => {
    await fakeBrowser.storage.local.set({
      'webpage-translation-settings': {
        openAi: {
          apiKey: 'key',
          baseUrl: 'https://api.example.test/v1',
          dialect: 'generic-openai',
          translation: {
            model: 'current-model',
            reasoning: { mode: 'off' },
            timeoutMs: 30_000,
          },
          agent: {
            inheritTranslationModel: false,
            profile: {
              model: 'agent-model',
              reasoning: { mode: 'auto' },
              timeoutMs: 120_000,
            },
          },
        },
      },
    });

    await expect(getSettings()).resolves.toMatchObject({
      openAi: {
        defaultModel: 'current-model',
        agent: {
          inheritDefaultModel: false,
          profile: { model: 'agent-model' },
        },
      },
    });
  });
});
