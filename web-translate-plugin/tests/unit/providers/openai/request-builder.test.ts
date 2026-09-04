import { describe, expect, it } from 'vitest';

import { buildChatRequest } from '../../../../src/providers/openai/request-builder';
import type { OpenAiSettings } from '../../../../src/settings/schema';

function settings(dialect: OpenAiSettings['dialect']): OpenAiSettings {
  return {
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    dialect,
    defaultModel: 'translate-model',
    translation: {
      reasoning: { mode: 'off' },
      timeoutMs: 30_000,
    },
    agent: {
      inheritDefaultModel: false,
      profile: {
        model: 'agent-model',
        reasoning: { mode: 'on', effort: 'high', budgetTokens: 4096 },
        timeoutMs: 120_000,
      },
    },
  };
}

const messages = [{ role: 'user' as const, content: 'Hello' }];

describe('OpenAI 兼容请求构造器', () => {
  it.each([
    'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    'https://proxy.example/v1',
  ])('显式严格模式使用统一翻译 Schema：%s', (baseUrl) => {
    const result = buildChatRequest({
      purpose: 'translation', messages,
      settings: { ...settings('dashscope'), baseUrl, defaultModel: 'any-model',
        translation: { ...settings('dashscope').translation, outputMode: 'json_schema' } },
    });
    expect(result.body).toMatchObject({ stream: true, enable_thinking: false });
    expect(result.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'translation_result', strict: true,
        schema: {
          type: 'object', additionalProperties: false, required: ['translations'],
          properties: {
            translations: {
              type: 'array', items: {
                type: 'object', additionalProperties: false, required: ['id', 'text'],
                properties: { id: { type: 'string' }, text: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    expect(result.body).not.toHaveProperty('max_tokens');
  });

  it.each([
    { baseUrl: 'https://proxy.example/v1' },
    { baseUrl: 'not-a-url' },
    { baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com:8443/compatible-mode/v1' },
    { baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1?proxy=1' },
    { baseUrl: 'https://test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' },
    { baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com.evil.test/compatible-mode/v1' },
    { baseUrl: 'http://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    { baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com/other/v1' },
    { defaultModel: 'qwen-max' },
    { defaultModel: 'qwen3.8-max-custom' },
    { dialect: 'generic-openai' as const },
  ])('无能力记录时不根据模型或地址猜测严格模式：%j', (overrides) => {
    const result = buildChatRequest({
      purpose: 'translation', messages,
      settings: { ...settings('dashscope'),
        baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen3.8-max', ...overrides },
    });
    expect(result.body.response_format).toEqual({ type: 'json_object' });
  });

  it.each(['connection-test', 'agent'] as const)('严格 Schema 不影响 %s', (purpose) => {
    const result = buildChatRequest({ purpose, messages, settings: {
      ...settings('dashscope'), defaultModel: 'qwen3.8-max',
      translation: { ...settings('dashscope').translation, outputMode: 'json_schema' },
      baseUrl: 'https://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    } });
    expect(result.body).not.toHaveProperty('response_format');
    expect(result.body.enable_thinking).toBe(purpose === 'agent');
  });

  it('快速连通测试固定关闭思考、限制输出且不要求 JSON', () => {
    const result = buildChatRequest({
      purpose: 'connection-test',
      settings: settings('dashscope'),
      messages,
    });

    expect(result.timeoutMs).toBe(15_000);
    expect(result.body).toEqual({
      model: 'translate-model',
      messages,
      max_tokens: 16,
      enable_thinking: false,
    });
  });

  it('翻译固定关闭思考并启用 JSON Object', () => {
    const result = buildChatRequest({
      purpose: 'translation',
      settings: settings('dashscope'),
      messages,
    });

    expect(result.timeoutMs).toBe(30_000);
    expect(result.body).toMatchObject({
      model: 'translate-model',
      response_format: { type: 'json_object' },
      stream: true,
      enable_thinking: false,
    });
  });

  it('翻译和智能体请求启用流式响应，但只有翻译要求 JSON Object', () => {
    expect(
      buildChatRequest({ purpose: 'connection-test', settings: settings('dashscope'), messages }).body,
    ).not.toHaveProperty('stream');
    const agent = buildChatRequest({ purpose: 'agent', settings: settings('dashscope'), messages }).body;
    expect(agent).toMatchObject({ stream: true });
    expect(agent).not.toHaveProperty('response_format');
  });

  it('按方言映射智能体思考参数', () => {
    expect(
      buildChatRequest({ purpose: 'agent', settings: settings('dashscope'), messages }).body,
    ).toMatchObject({ enable_thinking: true, thinking_budget: 4096 });
    expect(
      buildChatRequest({ purpose: 'agent', settings: settings('openai'), messages }).body,
    ).toMatchObject({ reasoning_effort: 'high' });

    const minimax = settings('minimax');
    minimax.agent.profile.reasoning = { mode: 'auto' };
    expect(
      buildChatRequest({ purpose: 'agent', settings: minimax, messages }).body,
    ).toMatchObject({ thinking: { type: 'adaptive' } });
    minimax.agent.profile.reasoning = { mode: 'off' };
    expect(
      buildChatRequest({ purpose: 'agent', settings: minimax, messages }).body,
    ).toMatchObject({ thinking: { type: 'disabled' } });
  });

  it('拒绝方言不支持的显式思考模式', () => {
    expect(() =>
      buildChatRequest({ purpose: 'agent', settings: settings('generic-openai'), messages }),
    ).toThrow('不支持显式开启思考');
    expect(() =>
      buildChatRequest({ purpose: 'agent', settings: settings('minimax'), messages }),
    ).toThrow('仅支持关闭或自动思考');
  });

  it('智能体可继承翻译模型但保留自己的思考与超时配置', () => {
    const value = settings('openai');
    value.agent.inheritDefaultModel = true;
    const result = buildChatRequest({ purpose: 'agent', settings: value, messages });

    expect(result.body.model).toBe('translate-model');
    expect(result.timeoutMs).toBe(120_000);
  });
});
