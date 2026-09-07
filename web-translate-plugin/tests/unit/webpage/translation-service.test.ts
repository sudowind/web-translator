import { describe, expect, it, vi } from 'vitest';

import type { OpenAiTranslationClient } from '../../../src/providers/openai/client';
import { WebpageTranslationService } from '../../../src/webpage/translation-service';

const settings = {
  openAi: {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    dialect: 'generic-openai' as const,
    defaultModel: 'translate-model',
    translation: {
      reasoning: { mode: 'off' as const },
      timeoutMs: 30_000,
    },
    agent: {
      inheritDefaultModel: true,
      profile: {
        model: 'translate-model',
        reasoning: { mode: 'auto' as const },
        timeoutMs: 120_000,
      },
    },
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
  it('清缓存覆盖尚在读取配置的旧请求，不允许初始化后回填', async () => {
    let resolveSettings!: (value: typeof settings) => void;
    const cache = { get: async () => undefined, put: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
    const service = new WebpageTranslationService(() => new Promise(resolve => { resolveSettings = resolve; }),
      () => ({ translate: async () => [{ id: 'a', text: '好' }] }), undefined, { cache });
    const sender = { tab: { id: 7, url: 'https://example.test/article' } };
    const pending = service.handle({ type: 'translation:blocks', sessionId: 's', blocks: [{ id: 'a', text: 'Hello' }] }, sender);
    await service.handle({ type: 'translation:clear-cache', sessionId: 's' }, sender);
    resolveSettings(settings); await pending;
    expect(cache.put).not.toHaveBeenCalled(); expect(cache.clear).toHaveBeenCalledOnce();
  });
  it('同批同文合并、缓存复用和配置隔离，清理阻止在途回填', async () => {
    const values = new Map<string, string>();
    const cache = { get: async (key: string) => values.get(key), put: vi.fn(async (key: string, _scope: string, text: string) => { values.set(key, text); }), clear: async () => { values.clear(); } };
    const emit = vi.fn(async () => undefined);
    let finish: (() => void) | undefined;
    let hold = false;
    const translate = vi.fn(async request => {
      if (hold) await new Promise<void>(resolve => { finish = resolve; });
      return request.blocks.map((block: {id: string}) => ({ id: block.id, text: '你好' }));
    });
    let current = settings;
    const service = new WebpageTranslationService(async () => current, () => ({ translate }), undefined, { cache, emit });
    const sender = { tab: { id: 7, url: 'https://example.test/article' } };
    const message = { type: 'translation:blocks', sessionId: 's', blocks: [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'Hello' }] };
    expect(await service.handle(message, sender)).toHaveLength(2);
    expect(translate.mock.calls[0][0].blocks).toHaveLength(1);
    await service.handle(message, sender); expect(translate).toHaveBeenCalledOnce();
    current = { ...settings, targetLanguage: 'ja' }; hold = true;
    const pending = service.handle(message, sender);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await service.handle({ type: 'translation:clear-cache', sessionId: 's' }, sender);
    finish!(); await pending; expect(values.size).toBe(0);
    expect(translate).toHaveBeenCalledTimes(2);
  });
  it('只为真实标签页使用后台设置发起翻译', async () => {
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const recordHistory = vi.fn().mockResolvedValue(undefined);
    const service = new WebpageTranslationService(
      async () => settings,
      () => ({ translate }) as unknown as OpenAiTranslationClient,
      recordHistory,
    );

    await expect(
      service.handle(
        {
          type: 'translation:blocks',
          sessionId: 'session-1',
          blocks: [{ id: 'b1', text: 'Hello' }],
        },
        { tab: { id: 7, url: 'https://article.example.test/story#intro', title: 'Story' } },
      ),
    ).resolves.toEqual([{ id: 'b1', text: '你好' }]);

    expect(translate).toHaveBeenCalledWith(
      {
        format: 'webpage-inline',
        blocks: [{ id: 'b1', text: 'Hello' }],
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      },
      expect.any(AbortSignal),
      expect.objectContaining({ onBlock: expect.any(Function), onTiming: expect.any(Function) }),
    );
    expect(recordHistory).toHaveBeenCalledWith(expect.objectContaining({
      id: 'webpage:https://article.example.test/story', kind: 'webpage',
      url: 'https://article.example.test/story', title: 'Story',
      sourceLanguage: 'en', targetLanguage: 'zh-CN',
    }));
  });

  it('同一翻译会话只记录一次历史且历史失败不影响译文', async () => {
    const translate = vi.fn(async request => request.blocks.map((block: {id: string}) => ({ id: block.id, text: '你好' })));
    const recordHistory = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const service = new WebpageTranslationService(
      async () => settings,
      () => ({ translate }) as unknown as OpenAiTranslationClient,
      recordHistory,
    );
    const sender = { tab: { id: 7, url: 'https://article.example.test/story', title: '' } };
    await service.handle({ type: 'translation:blocks', sessionId: 'session-1', blocks: [{ id: 'b1', text: 'Hello' }] }, sender);
    await service.handle({ type: 'translation:blocks', sessionId: 'session-1', blocks: [{ id: 'b2', text: 'World' }] }, sender);
    expect(recordHistory).toHaveBeenCalledTimes(1);
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
