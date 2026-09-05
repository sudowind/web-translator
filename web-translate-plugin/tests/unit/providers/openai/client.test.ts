import { describe, expect, it, vi } from 'vitest';

import { OpenAiTranslationClient } from '../../../../src/providers/openai/client';

function sseResponse(content: string): Response {
  const event = JSON.stringify({ choices: [{ delta: { content } }] });
  return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAI 兼容翻译客户端', () => {
  const settings = {
    apiKey: 'secret-key',
    baseUrl: 'https://llm.example/v1/',
    dialect: 'dashscope' as const,
    defaultModel: 'translator',
    translation: {
      reasoning: { mode: 'off' as const },
      timeoutMs: 30_000,
    },
    agent: {
      inheritDefaultModel: true,
      profile: {
        model: 'translator',
        reasoning: { mode: 'auto' as const },
        timeoutMs: 120_000,
      },
    },
  };

  it('使用 chat completions JSON Object 协议并按 block id 返回结果', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse(
        JSON.stringify({
          translations: [
            { id: 'b2', text: '世界' },
            { id: 'b1', text: '你好' },
          ],
        }),
      ),
    );
    const controller = new AbortController();
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate(
        {
          blocks: [
            { id: 'b1', kind: 'paragraph', text: 'Hello' },
            { id: 'b2', kind: 'table', text: '| A | B |' },
          ],
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
        },
        controller.signal,
      ),
    ).resolves.toEqual([
      { id: 'b1', text: '你好' },
      { id: 'b2', text: '世界' },
    ]);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer secret-key' }),
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual(
      expect.objectContaining({
        model: 'translator',
        response_format: { type: 'json_object' },
        stream: true,
      }),
    );
    expect(body.messages[0].content).toContain('Preserve Markdown structure');
    expect(body.messages[0].content).toContain('"translations":[{"id":');
    expect(body.messages[0].content).toContain('"text":');
    expect(body.messages[0].content).toContain('Both id and text must be strings');
    expect(body.messages[0].content).toContain('Do not translate math expressions');
    expect(body.messages[0].content).toContain('For table and figure blocks, the input text is caption only');
    expect(body.messages[0].content).toContain('never output a table body or image content');
    expect(body.messages[0].content).not.toContain('table rows/columns');
    expect(JSON.parse(body.messages[1].content).blocks[1]).toEqual({ id: 'b2', kind: 'table', text: '| A | B |' });
  });

  it('显式严格 Schema 解析分片 SSE，仍按原始 ID 对齐', async () => {
    const content = JSON.stringify({ translations: [{ id: 'b2', text: '**结果**' }, { id: 'b1', text: '公式 $x^2$' }] });
    const midpoint = Math.floor(content.length / 2);
    const events = [content.slice(0, midpoint), content.slice(midpoint)]
      .map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`).join('');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(events + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const client = new OpenAiTranslationClient({
      ...settings, defaultModel: 'qwen3.8-max',
      translation: { ...settings.translation, outputMode: 'json_schema' },
      baseUrl: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    }, fetcher);
    await expect(client.translate({
      sourceLanguage: 'en', targetLanguage: 'zh-CN',
      blocks: [{ id: 'b1', text: 'Formula $x^2$' }, { id: 'b2', text: '**Results**' }],
    })).resolves.toEqual([{ id: 'b1', text: '公式 $x^2$' }, { id: 'b2', text: '**结果**' }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'qwen3.8-max', stream: true, enable_thinking: false,
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(body.messages[0].content).toContain('Both id and text must be strings');
  });

  it.each([
    ['malformed', '{broken'],
    [
      '未知 id',
      JSON.stringify({ translations: [{ id: 'other', text: '未知' }] }),
    ],
    ['缺失 id', JSON.stringify({ translations: [] })],
    [
      '重复 id',
      JSON.stringify({
        translations: [
          { id: 'b1', text: '一' },
          { id: 'b1', text: '二' },
        ],
      }),
    ],
  ])('拒绝%s响应', async (_label, content) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse(content),
    );
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate({
        blocks: [{ id: 'b1', kind: 'paragraph', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toThrow();
  });

  it('拒绝空配置和非 2xx HTTP', async () => {
    const emptyClient = new OpenAiTranslationClient(
      { ...settings, apiKey: '' },
      vi.fn<typeof fetch>(),
    );
    await expect(
      emptyClient.translate({
        blocks: [{ id: 'b1', kind: 'paragraph', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toThrow('翻译 Provider 配置不完整');

    const failedClient = new OpenAiTranslationClient(
      settings,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })),
    );
    await expect(
      failedClient.translate({
        blocks: [{ id: 'b1', kind: 'paragraph', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toMatchObject({ code: 'TRANSLATION_HTTP_503' });
  });

  it('在发起请求前拒绝重复的 request block id', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate({
        blocks: [
          { id: 'duplicate', kind: 'paragraph', text: 'First' },
          { id: 'duplicate', kind: 'paragraph', text: 'Second' },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toThrow('翻译请求包含重复 id: duplicate');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('将底层网络错误映射为稳定翻译错误码', async () => {
    const client = new OpenAiTranslationClient(
      settings,
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('secret network detail')),
    );
    await expect(
      client.translate({
        blocks: [{ id: 'b1', kind: 'paragraph', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toMatchObject({ code: 'TRANSLATION_NETWORK' });
  });

  it('调用原生 fetcher 时不绑定客户端实例为 this', async () => {
    let receivedThis: unknown = 'not-called';
    const fetcher = function (this: unknown) {
      receivedThis = this;
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        sseResponse(
          JSON.stringify({
            translations: [{ id: 'b1', text: '你好' }],
          }),
        ),
      );
    } as typeof fetch;
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate({
        blocks: [{ id: 'b1', kind: 'paragraph', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).resolves.toEqual([{ id: 'b1', text: '你好' }]);
    expect(receivedThis).toBeUndefined();
  });
});
