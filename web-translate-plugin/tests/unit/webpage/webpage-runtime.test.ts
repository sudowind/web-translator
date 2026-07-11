import { describe, expect, it, vi } from 'vitest';

import type { TranslationResult } from '../../../src/providers/openai/contracts';
import { WebpageTranslationRuntime } from '../../../src/webpage/webpage-runtime';

describe('WebpageTranslationRuntime', () => {
  it('重复启用保持幂等且不重复翻译', async () => {
    document.body.innerHTML = '<main><p>Hello world</p></main>';
    const sendMessage = vi.fn(async (message: unknown) => {
      const blocks = (message as { blocks: Array<{ id: string }> }).blocks;
      return blocks.map(({ id }) => ({ id, text: '你好，世界' }));
    });
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://article.example.test/story'),
      sendMessage,
      createSessionId: () => 'session-1',
    });

    await expect(runtime.enable()).resolves.toMatchObject({ enabled: true, count: 1 });
    await expect(runtime.enable()).resolves.toMatchObject({ enabled: true, count: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelector('p')?.textContent).toBe('你好，世界');
    await runtime.disable();
  });

  it('翻译动态新增文本且不重复处理既有节点', async () => {
    document.body.innerHTML = '<main><p>Initial English</p></main>';
    const seenIds: string[] = [];
    const sendMessage = vi.fn(async (message: unknown) => {
      const blocks = (message as { blocks: Array<{ id: string }> }).blocks;
      seenIds.push(...blocks.map(({ id }) => id));
      return blocks.map(({ id }) => ({ id, text: `译文-${id}` }));
    });
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://article.example.test/story'),
      sendMessage,
      createSessionId: () => 'session-1',
    });
    await runtime.enable();

    const dynamic = document.createElement('p');
    dynamic.textContent = 'Dynamic English';
    document.querySelector('main')!.append(dynamic);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(dynamic.textContent).toMatch(/^译文-/);
    expect(new Set(seenIds).size).toBe(seenIds.length);
    await runtime.disable();
  });

  it('翻译动态新增的直接 Text 并在移动已处理 Element 时不重复请求或计数', async () => {
    document.body.innerHTML = '<main><p id="moving">Initial English</p><section id="target"></section></main>';
    const translationMessages: unknown[] = [];
    const sendMessage = vi.fn(async (message: unknown) => {
      if ((message as { type: string }).type === 'translation:cancel') {
        return { canceled: true };
      }
      translationMessages.push(message);
      const blocks = (message as { blocks: Array<{ id: string }> }).blocks;
      return blocks.map(({ id }) => ({ id, text: `Translated English ${id}` }));
    });
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://article.example.test/story'),
      sendMessage,
      createSessionId: () => 'session-direct-text',
    });
    await runtime.enable();

    const directText = document.createTextNode('Direct dynamic English');
    document.querySelector('main')!.append(directText);
    await vi.waitFor(() => expect(directText.data).toMatch(/^Translated English/));
    expect(runtime.status()).toEqual({ enabled: true, count: 2 });
    expect(translationMessages).toHaveLength(2);

    document.querySelector('#target')!.append(document.querySelector('#moving')!);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.status()).toEqual({ enabled: true, count: 2 });
    expect(translationMessages).toHaveLength(2);
    await runtime.disable();
  });

  it('关闭会发出取消、忽略迟到结果并恢复原文', async () => {
    document.body.innerHTML = '<button id="action">Submit action</button>';
    let resolveTranslation!: (value: TranslationResult[]) => void;
    const sendMessage = vi.fn((message: unknown) => {
      if ((message as { type: string }).type === 'translation:cancel') {
        return Promise.resolve({ canceled: true });
      }
      return new Promise<TranslationResult[]>((resolve) => {
        resolveTranslation = resolve;
      });
    });
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://article.example.test/story'),
      sendMessage,
      createSessionId: () => 'session-race',
    });

    const enabling = runtime.enable();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    await runtime.disable();
    resolveTranslation([{ id: 'irrelevant', text: '迟到译文' }]);
    await enabling;

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'translation:cancel',
      sessionId: 'session-race',
    });
    expect(document.querySelector('#action')?.textContent).toBe('Submit action');
    expect(runtime.status()).toEqual({ enabled: false, count: 0 });
  });

  it('敏感页面返回结构化不可启用状态', async () => {
    document.body.innerHTML = '<input type="password">';
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://example.test/login'),
      sendMessage: vi.fn(),
      createSessionId: () => 'session-1',
    });

    await expect(runtime.enable()).resolves.toEqual({
      enabled: false,
      count: 0,
      reason: 'PAGE_NOT_ELIGIBLE',
    });
  });

  it('首次翻译失败时恢复页面并向 Popup 传递错误', async () => {
    document.body.innerHTML = '<p>Original English</p>';
    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL('https://article.example.test/story'),
      sendMessage: vi.fn(async (message: unknown) => {
        if ((message as { type: string }).type === 'translation:cancel') {
          return { canceled: true };
        }
        throw new Error('Provider unavailable');
      }),
      createSessionId: () => 'session-error',
    });

    await expect(runtime.enable()).rejects.toThrow('Provider unavailable');
    expect(document.querySelector('p')?.textContent).toBe('Original English');
    expect(runtime.status()).toEqual({ enabled: false, count: 0 });
  });
});
