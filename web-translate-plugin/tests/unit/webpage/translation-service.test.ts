import { describe, expect, it, vi } from 'vitest';

import type { OpenAiTranslationClient } from '../../../src/providers/openai/client';
import { WebpageTranslationService } from '../../../src/webpage/translation-service';

const settings = {
  openAi: {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    model: 'translate-model',
  },
  mineru: {
    baseUrl: 'https://mineru.net',
    token: '',
    modelVersion: 'vlm' as const,
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};

describe('WebpageTranslationService', () => {
  it('只为真实标签页使用后台设置发起翻译', async () => {
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const service = new WebpageTranslationService(
      async () => settings,
      () => ({ translate }) as unknown as OpenAiTranslationClient,
    );

    await expect(
      service.handle(
        {
          type: 'translation:blocks',
          sessionId: 'session-1',
          blocks: [{ id: 'b1', text: 'Hello' }],
        },
        { tab: { id: 7 } },
      ),
    ).resolves.toEqual([{ id: 'b1', text: '你好' }]);

    expect(translate).toHaveBeenCalledWith(
      {
        blocks: [{ id: 'b1', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      },
      expect.any(AbortSignal),
    );
  });

  it('拒绝非标签页调用与非法请求', async () => {
    const service = new WebpageTranslationService(
      async () => settings,
      () => ({ translate: vi.fn() }) as unknown as OpenAiTranslationClient,
    );

    await expect(
      service.handle(
        {
          type: 'translation:blocks',
          sessionId: 'session-1',
          blocks: [{ id: 'b1', text: 'Hello' }],
        },
        {},
      ),
    ).rejects.toThrow('真实标签页');
    await expect(
      service.handle(
        { type: 'translation:blocks', sessionId: 'session-1', blocks: [] },
        { tab: { id: 7 } },
      ),
    ).rejects.toThrow('消息格式');
  });

  it('取消同一标签页 session 的进行中请求但不影响其他标签页', async () => {
    const signals: AbortSignal[] = [];
    const translate = vi.fn((_request, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<never>(() => undefined);
    });
    const service = new WebpageTranslationService(
      async () => settings,
      () => ({ translate }) as unknown as OpenAiTranslationClient,
    );
    const message = {
      type: 'translation:blocks' as const,
      sessionId: 'session-shared',
      blocks: [{ id: 'b1', text: 'Hello' }],
    };

    void service.handle(message, { tab: { id: 7 } });
    void service.handle(message, { tab: { id: 8 } });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    await service.handle(
      { type: 'translation:cancel', sessionId: 'session-shared' },
      { tab: { id: 7 } },
    );

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
