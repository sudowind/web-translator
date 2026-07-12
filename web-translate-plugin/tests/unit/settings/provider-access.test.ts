import { describe, expect, it, vi } from 'vitest';

import {
  authorizeProviderSettings,
  checkMineruConfiguration,
  normalizeMineruBaseUrl,
  providerOriginPattern,
  validateProviderSettings,
} from '../../../src/settings/provider-access';
import { resolveAgentProfile } from '../../../src/settings/schema';

const validSettings = {
  openAi: {
    baseUrl: 'https://api.example.test:8443/v1/',
    apiKey: ' secret ',
    dialect: 'generic-openai' as const,
    defaultModel: ' model-name ',
    translation: {
      reasoning: { mode: 'off' as const },
      timeoutMs: 30_000,
    },
    agent: {
      inheritDefaultModel: true,
      profile: {
        model: ' agent-model ',
        reasoning: { mode: 'auto' as const, effort: 'medium' as const },
        timeoutMs: 120_000,
      },
    },
  },
  mineru: {
    baseUrl: 'https://mineru.example.test/',
    token: ' mineru-secret ',
    modelVersion: 'vlm' as const,
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('Provider 设置授权', () => {
  it('MinerU 配置检查申请 API 与官方结果 CDN Origin 且不创建解析任务', async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    await expect(
      checkMineruConfiguration(validSettings.mineru, requestPermission),
    ).resolves.toEqual({
      baseUrl: 'https://mineru.example.test',
      token: 'mineru-secret',
      modelVersion: 'vlm',
    });
    expect(requestPermission).toHaveBeenCalledWith({
      origins: [
        'https://mineru.example.test/*',
        'https://cdn-mineru.openxlab.org.cn/*',
      ],
    });
  });

  it('只接受 MinerU HTTPS Origin 根地址', () => {
    expect(normalizeMineruBaseUrl('https://mineru.net/')).toBe(
      'https://mineru.net',
    );
    expect(() =>
      normalizeMineruBaseUrl('https://mineru.net/apiManage/docs'),
    ).toThrow('MinerU 接口地址必须填写 API 根地址');
    expect(() =>
      normalizeMineruBaseUrl('https://mineru.net/?from=docs'),
    ).toThrow('MinerU 接口地址必须填写 API 根地址');
    expect(() => normalizeMineruBaseUrl('https://mineru.net/#docs')).toThrow(
      'MinerU 接口地址必须填写 API 根地址',
    );
  });

  it('只计算精确 HTTPS Origin pattern', () => {
    expect(providerOriginPattern(validSettings.openAi.baseUrl)).toBe(
      'https://api.example.test:8443/*',
    );
    expect(() => providerOriginPattern('http://api.example.test/v1')).toThrow(
      'HTTPS',
    );
    expect(() => providerOriginPattern('https://user:pass@example.test/v1')).toThrow(
      '凭据',
    );
  });

  it('校验必填设置并标准化用户输入', () => {
    expect(validateProviderSettings(validSettings)).toEqual({
      ...validSettings,
      openAi: {
        baseUrl: 'https://api.example.test:8443/v1',
        apiKey: 'secret',
        dialect: 'generic-openai',
        defaultModel: 'model-name',
        translation: {
          reasoning: { mode: 'off' },
          timeoutMs: 30_000,
        },
        agent: {
          inheritDefaultModel: true,
          profile: {
            model: 'agent-model',
            reasoning: { mode: 'auto', effort: 'medium' },
            timeoutMs: 120_000,
          },
        },
      },
      mineru: {
        baseUrl: 'https://mineru.example.test',
        token: 'mineru-secret',
        modelVersion: 'vlm',
      },
    });
    expect(() =>
      validateProviderSettings({
        ...validSettings,
        openAi: { ...validSettings.openAi, apiKey: '' },
      }),
    ).toThrow('API Key');
    expect(() =>
      validateProviderSettings({
        ...validSettings,
        openAi: { ...validSettings.openAi, defaultModel: ' ' },
      }),
    ).toThrow('默认模型不能为空');
  });

  it('解析继承模型并拒绝通用接口开启思考', () => {
    expect(resolveAgentProfile(validSettings.openAi).model).toBe(
      validSettings.openAi.defaultModel,
    );
    expect(() => validateProviderSettings({
      ...validSettings,
      openAi: {
        ...validSettings.openAi,
        agent: {
          inheritDefaultModel: false,
          profile: {
            model: 'agent-model',
            reasoning: { mode: 'on' },
            timeoutMs: 120_000,
          },
        },
      },
    })).toThrow('通用 OpenAI 兼容接口无法确认思考协议');
  });

  it('继承默认模型时保存仍保留独立智能体模型', () => {
    const validated = validateProviderSettings(validSettings);
    expect(validated.openAi.agent.profile.model).toBe('agent-model');
    expect(resolveAgentProfile(validated.openAi).model).toBe('model-name');

    const emptyStoredModel = validateProviderSettings({
      ...validSettings,
      openAi: {
        ...validSettings.openAi,
        agent: {
          ...validSettings.openAi.agent,
          profile: { ...validSettings.openAi.agent.profile, model: ' ' },
        },
      },
    });
    expect(emptyStoredModel.openAi.agent.profile.model).toBe('');
    expect(resolveAgentProfile(emptyStoredModel.openAi).model).toBe('model-name');
  });

  it('权限拒绝时不返回可保存配置', async () => {
    const requestPermission = vi.fn().mockResolvedValue(false);
    await expect(
      authorizeProviderSettings(validSettings, requestPermission),
    ).rejects.toThrow('授权');
    expect(requestPermission).toHaveBeenCalledWith({
      origins: [
        'https://api.example.test:8443/*',
        'https://mineru.example.test/*',
        'https://cdn-mineru.openxlab.org.cn/*',
      ],
    });
  });

  it('MinerU token 为空时不影响 OpenAI 保存且不请求 MinerU Origin', async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    const settings = {
      ...validSettings,
      mineru: { baseUrl: 'not-a-url', token: ' ', modelVersion: 'invalid' as 'vlm' },
    };
    const result = await authorizeProviderSettings(settings, requestPermission);
    expect(result.mineru).toEqual({ baseUrl: 'https://mineru.net', token: '', modelVersion: 'vlm' });
    expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://api.example.test:8443/*'] });
  });

  it('MinerU token 已填写时校验 HTTPS 和模型版本', () => {
    expect(() => validateProviderSettings({
      ...validSettings,
      mineru: { ...validSettings.mineru, baseUrl: 'http://mineru.example.test' },
    })).toThrow('HTTPS');
    expect(() => validateProviderSettings({
      ...validSettings,
      mineru: { ...validSettings.mineru, modelVersion: 'unknown' as 'vlm' },
    })).toThrow('MinerU 模型');
  });
});
