import { describe, expect, it, vi } from 'vitest';

import { translatePage } from '../../../src/translation/translate-page';

const page = {
  id: 'h:p1', index: 0,
  blocks: [
    { id: 'b1', pageId: 'h:p1', order: 0, kind: 'paragraph' as const, text: 'Hello' },
    { id: 'b2', pageId: 'h:p1', order: 1, kind: 'formula' as const, text: 'x', latex: 'x' },
  ],
};

describe('逐页翻译', () => {
  it('只发送可翻译块并保留严格 ID', async () => {
    const translate = vi.fn().mockResolvedValue([{ id: 'b1', text: '你好' }]);
    await expect(translatePage({ translate }, page, { sourceLanguage: 'en', targetLanguage: 'zh-CN' })).resolves.toEqual([{ id: 'b1', text: '你好' }]);
    expect(translate).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'zh-CN', blocks: [{ id: 'b1', text: 'Hello' }] }, undefined);
  });

  it('429/5xx 最多重试三次，401 不重试，sleep 可注入', async () => {
    const retrying = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('server'), { status: 503 }))
      .mockResolvedValue([{ id: 'b1', text: '你好' }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(translatePage({ translate: retrying }, page, { sourceLanguage: 'en', targetLanguage: 'zh-CN' }, undefined, sleep)).resolves.toHaveLength(1);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);

    const unauthorized = vi.fn().mockRejectedValue(Object.assign(new Error('secret body'), { status: 401 }));
    await expect(translatePage({ translate: unauthorized }, page, { sourceLanguage: 'en', targetLanguage: 'zh-CN' })).rejects.toMatchObject({ code: 'TRANSLATION_HTTP_401' });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('退避期间取消会立即拒绝且不等待 sleep 完成', async () => {
    const translate = vi.fn().mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }));
    let started!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { started = resolve; });
    const sleep = vi.fn(() => {
      started();
      return new Promise<void>(() => undefined);
    });
    const controller = new AbortController();
    const pending = translatePage(
      { translate }, page,
      { sourceLanguage: 'en', targetLanguage: 'zh-CN' },
      controller.signal,
      sleep,
    );
    await sleepStarted;
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  });
});
