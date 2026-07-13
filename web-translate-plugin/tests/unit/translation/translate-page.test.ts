import { describe, expect, it, vi } from 'vitest';

import { TranslationProviderError } from '../../../src/providers/openai/client';
import { translatePage } from '../../../src/translation/translate-page';

const page = {
  id: 'h:p1', index: 0,
  blocks: [
    { id: 'h1', pageId: 'h:p1', order: 0, kind: 'heading' as const, text: 'Title' },
    { id: 'b1', pageId: 'h:p1', order: 0, kind: 'paragraph' as const, text: 'Hello' },
    { id: 'b2', pageId: 'h:p1', order: 1, kind: 'formula' as const, text: 'x', latex: 'x' },
    { id: 't1', pageId: 'h:p1', order: 2, kind: 'table' as const, text: 'table OCR', caption: 'Table title', html: '<table><tr><td>secret</td></tr></table>' },
    { id: 'f1', pageId: 'h:p1', order: 3, kind: 'figure' as const, text: 'image OCR', caption: 'Figure title', resourceUrl: 'images/secret.png' },
    { id: 't2', pageId: 'h:p1', order: 4, kind: 'table' as const, text: 'no title', html: '<table></table>' },
    { id: 'f2', pageId: 'h:p1', order: 5, kind: 'figure' as const, text: 'no title', resourceUrl: 'images/no-title.png' },
  ],
};

describe('逐页翻译', () => {
  it('只发送可翻译块并保留严格 ID', async () => {
    const translate = vi.fn().mockResolvedValue([
      { id: 'h1', text: '标题' }, { id: 'b1', text: '你好' }, { id: 't1', text: '|列|\n|---|\n|甲|' },
      { id: 'f1', text: '图片标题' },
    ]);
    await expect(translatePage({ translate }, page, { sourceLanguage: 'en', targetLanguage: 'zh-CN' })).resolves.toHaveLength(4);
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: 'en', targetLanguage: 'zh-CN',
      blocks: [
        { id: 'h1', kind: 'heading', text: 'Title' },
        { id: 'b1', kind: 'paragraph', text: 'Hello' },
        { id: 't1', kind: 'table', text: 'Table title' },
        { id: 'f1', kind: 'figure', text: 'Figure title' },
      ],
    }, undefined);
    const request = JSON.stringify(translate.mock.calls[0][0]);
    expect(request).not.toContain('secret');
    expect(request).not.toContain('table OCR');
    expect(request).not.toContain('image OCR');
    expect(request).not.toContain('t2');
    expect(request).not.toContain('f2');
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

  it('识别稳定 Provider 错误码并只重试临时错误', async () => {
    const retrying = vi.fn()
      .mockRejectedValueOnce(new TranslationProviderError('TRANSLATION_HTTP_429'))
      .mockRejectedValueOnce(new TranslationProviderError('TRANSLATION_HTTP_503'))
      .mockResolvedValueOnce([{ id: 'b1', text: '你好' }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(translatePage(
      { translate: retrying }, page,
      { sourceLanguage: 'en', targetLanguage: 'zh-CN' },
      undefined, sleep, 'qwen-plus',
    )).resolves.toHaveLength(1);
    expect(retrying).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);

    for (const code of ['TRANSLATION_TIMEOUT', 'TRANSLATION_JSON_INVALID', 'TRANSLATION_ID_MISSING']) {
      const translate = vi.fn().mockRejectedValue(new TranslationProviderError(code));
      await expect(translatePage(
        { translate }, page,
        { sourceLanguage: 'en', targetLanguage: 'zh-CN' },
        undefined, undefined, 'qwen-plus',
      )).rejects.toMatchObject({ failure: { code, attempts: 1 } });
      expect(translate).toHaveBeenCalledOnce();
    }
  });
});
