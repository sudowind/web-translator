import { describe, expect, it, vi } from 'vitest';

import { OpenAiPaperAgentClient } from '../../../src/agent/client';

const context = { mode: 'full' as const, text: '[p:1]\nEvidence', recentMessages: [] };

const settings = {
  apiKey: 'secret',
  baseUrl: 'https://api.test/v1',
  dialect: 'openai' as const,
  defaultModel: 'translation-model',
  translation: {
    reasoning: { mode: 'off' as const },
    timeoutMs: 30_000,
  },
  agent: {
    inheritDefaultModel: false,
    profile: {
      model: 'agent-model',
      reasoning: { mode: 'on' as const, effort: 'medium' as const },
      timeoutMs: 120_000,
    },
  },
};

describe('后台论文问答客户端', () => {
  it('要求仅根据论文回答并使用 [p:N] 引用', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Answer [p:1]' } }] }),
        { status: 200 },
      ),
    );
    const client = new OpenAiPaperAgentClient(settings, fetcher);

    await expect(client.ask(context, 'What?', undefined)).resolves.toBe('Answer [p:1]');
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain('[p:N]');
    expect(body.messages.at(-1).content).toContain('[p:1]');
    expect(body).toMatchObject({ model: 'agent-model', reasoning_effort: 'medium' });
  });

  it('HTTP 与响应错误只暴露安全结构化码', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret raw body', { status: 401 }));
    const client = new OpenAiPaperAgentClient({ ...settings, apiKey: 'super-secret' }, fetcher);

    await expect(client.ask(context, 'What?')).rejects.toMatchObject({ code: 'AGENT_HTTP_401' });
    try {
      await client.ask(context, 'What?');
    } catch (error) {
      expect(String(error)).not.toContain('super-secret');
      expect(String(error)).not.toContain('raw body');
    }
  });
});
