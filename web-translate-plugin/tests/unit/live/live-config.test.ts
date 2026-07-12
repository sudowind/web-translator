import { describe, expect, it } from 'vitest';

import { parseLiveConfig } from '../../live/live-config';

const validLlm = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'private-key',
  model: 'model',
  timeoutMs: 120_000,
};

describe('在线验收本地配置', () => {
  it('把本地 MinerU 与 LLM 配置转换为生产设置', () => {
    const result = parseLiveConfig(
      {
        baseUrl: 'https://mineru.net',
        token: 'private-token',
        modelVersion: 'vlm',
      },
      validLlm,
    );

    expect(result.mineru).toEqual({
      baseUrl: 'https://mineru.net',
      token: 'private-token',
      modelVersion: 'vlm',
    });
    expect(result.openAi).toMatchObject({
      apiKey: 'private-key',
      baseUrl: 'https://example.test/v1',
      defaultModel: 'model',
      dialect: 'generic-openai',
    });
    expect(result.openAi.translation.timeoutMs).toBe(120_000);
    expect(result).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'zh-CN' });
  });

  it.each([
    [
      'MinerU Token',
      { baseUrl: 'https://mineru.net', token: '', modelVersion: 'vlm' },
    ],
    [
      'MinerU API 根地址',
      { baseUrl: 'https://mineru.net/api/v4', token: 'private', modelVersion: 'vlm' },
    ],
    [
      'MinerU 模型版本',
      { baseUrl: 'https://mineru.net', token: 'private', modelVersion: 'bad' },
    ],
  ])('%s 无效时只报告字段名', (message, mineru) => {
    expect(() => parseLiveConfig(mineru, validLlm)).toThrow(message);
  });

  it.each([
    ['LLM API Key', { ...validLlm, apiKey: '' }],
    ['LLM API 根地址', { ...validLlm, baseUrl: 'not-a-url' }],
    ['LLM 模型', { ...validLlm, model: '' }],
    ['LLM 超时', { ...validLlm, timeoutMs: 0 }],
  ])('%s 无效时只报告字段名', (message, llm) => {
    expect(() =>
      parseLiveConfig(
        { baseUrl: 'https://mineru.net', token: 'private', modelVersion: 'vlm' },
        llm,
      ),
    ).toThrow(message);
  });
});
