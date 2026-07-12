import { describe, expect, it } from 'vitest';

import { buildChatRequest } from '../../../../src/providers/openai/request-builder';
import type { OpenAiSettings } from '../../../../src/settings/schema';

function settings(dialect: OpenAiSettings['dialect']): OpenAiSettings {
  return {
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    dialect,
    translation: {
      model: 'translate-model',
      reasoning: { mode: 'off' },
      timeoutMs: 30_000,
    },
    agent: {
      inheritTranslationModel: false,
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
      enable_thinking: false,
    });
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
    value.agent.inheritTranslationModel = true;
    const result = buildChatRequest({ purpose: 'agent', settings: value, messages });

    expect(result.body.model).toBe('translate-model');
    expect(result.timeoutMs).toBe(120_000);
  });
});
