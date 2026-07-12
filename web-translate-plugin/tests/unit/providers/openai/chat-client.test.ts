import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmProviderError, OpenAiChatClient } from '../../../../src/providers/openai/chat-client';
import type { OpenAiSettings } from '../../../../src/settings/schema';

const settings: OpenAiSettings = {
  apiKey: 'secret',
  baseUrl: 'https://example.test/v1/',
  dialect: 'dashscope',
  defaultModel: 'model',
  translation: {
    reasoning: { mode: 'off' },
    timeoutMs: 30_000,
  },
  agent: {
    inheritDefaultModel: true,
    profile: {
      model: 'model',
      reasoning: { mode: 'auto' },
      timeoutMs: 120_000,
    },
  },
};

afterEach(() => vi.useRealTimers());

describe('OpenAI 兼容传输层', () => {
  it('发送构造后的请求并读取文本内容', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
      }),
    );
    const client = new OpenAiChatClient(settings, fetcher);

    await expect(
      client.complete({
        purpose: 'connection-test',
        messages: [{ role: 'user', content: 'Reply OK' }],
      }),
    ).resolves.toBe('OK');

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer secret' }));
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'model',
      max_tokens: 16,
      enable_thinking: false,
    });
  });

  it('将 HTTP 与无效响应转换为不泄露正文的结构化错误', async () => {
    const failed = new OpenAiChatClient(
      settings,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('secret body', { status: 404 })),
    );
    await expect(
      failed.complete({ purpose: 'connection-test', messages: [] }),
    ).rejects.toMatchObject({ code: 'LLM_HTTP_404' });

    const invalid = new OpenAiChatClient(
      settings,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    await expect(
      invalid.complete({ purpose: 'connection-test', messages: [] }),
    ).rejects.toMatchObject({ code: 'LLM_RESPONSE_INVALID' });
  });

  it('超时与调用方主动取消使用不同错误', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    const client = new OpenAiChatClient(settings, fetcher);
    const timedOut = expect(
      client.complete({ purpose: 'connection-test', messages: [] }),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;

    vi.useRealTimers();
    const controller = new AbortController();
    const aborted = client.complete(
      { purpose: 'connection-test', messages: [] },
      controller.signal,
    );
    controller.abort();
    await expect(aborted).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
  });

  it('网络失败使用稳定错误码', async () => {
    const client = new OpenAiChatClient(
      settings,
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch secret')),
    );
    await expect(
      client.complete({ purpose: 'connection-test', messages: [] }),
    ).rejects.toEqual(new LlmProviderError('LLM_NETWORK'));
  });
});
