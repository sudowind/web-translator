import { describe, expect, it, vi } from 'vitest';

import { OpenAiTranslationClient } from '../../../../src/providers/openai/client';

describe('OpenAI 兼容翻译客户端', () => {
  const settings = {
    apiKey: 'secret-key',
    baseUrl: 'https://llm.example/v1/',
    model: 'translator',
  };

  it('使用 chat completions JSON Object 协议并按 block id 返回结果', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [
                    { id: 'b2', text: '世界' },
                    { id: 'b1', text: '你好' },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const controller = new AbortController();
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate(
        {
          blocks: [
            { id: 'b1', text: 'Hello' },
            { id: 'b2', text: 'World' },
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
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer secret-key' }),
    );
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        model: 'translator',
        response_format: { type: 'json_object' },
      }),
    );
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
      new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200 },
      ),
    );
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate({
        blocks: [{ id: 'b1', text: 'Hello' }],
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
        blocks: [{ id: 'b1', text: 'Hello' }],
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
        blocks: [{ id: 'b1', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toThrow('翻译请求失败 (503)');
  });

  it('在发起请求前拒绝重复的 request block id', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new OpenAiTranslationClient(settings, fetcher);

    await expect(
      client.translate({
        blocks: [
          { id: 'duplicate', text: 'First' },
          { id: 'duplicate', text: 'Second' },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ).rejects.toThrow('翻译请求包含重复 id: duplicate');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
