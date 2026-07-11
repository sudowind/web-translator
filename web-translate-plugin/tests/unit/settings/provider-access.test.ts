import { describe, expect, it, vi } from 'vitest';

import {
  authorizeProviderSettings,
  providerOriginPattern,
  validateProviderSettings,
} from '../../../src/settings/provider-access';

const validSettings = {
  openAi: {
    baseUrl: 'https://api.example.test:8443/v1/',
    apiKey: ' secret ',
    model: ' model-name ',
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('Provider 设置授权', () => {
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
      origins: ['https://api.example.test:8443/*'],
    });
  });
});
