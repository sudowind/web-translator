import { describe, expect, it, vi } from 'vitest';

import {
  authorizeProviderSettings,
  checkMineruConfiguration,
  normalizeMineruBaseUrl,
  providerOriginPattern,
  validateProviderSettings,
} from '../../../src/settings/provider-access';

const validSettings = {
  openAi: {
    baseUrl: 'https://api.example.test:8443/v1/',
    apiKey: ' secret ',
    model: ' model-name ',
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
  it('MinerU 配置检查只申请自身 Origin 且不创建解析任务', async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    await expect(
      checkMineruConfiguration(validSettings.mineru, requestPermission),
    ).resolves.toEqual({
      baseUrl: 'https://mineru.example.test',
      token: 'mineru-secret',
      modelVersion: 'vlm',
    });
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ['https://mineru.example.test/*'],
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
        model: 'model-name',
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
