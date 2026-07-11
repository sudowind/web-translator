import { describe, expect, it, vi } from 'vitest';

import {
  sendWebpageCommand,
  webpagePopupErrorText,
} from '../../../src/webpage/popup-client';

describe('sendWebpageCommand', () => {
  it('启用时以 activeTab 注入固定 runtime bundle 后发送消息', async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: { enabled: true, count: 2 },
    });
    const api = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 17 }]),
        sendMessage,
      },
      scripting: { executeScript },
    };

    await expect(sendWebpageCommand('webpage:enable', api)).resolves.toEqual({
      enabled: true,
      count: 2,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 },
      files: ['/content-scripts/webpage.js'],
    });
    expect(sendMessage).toHaveBeenCalledWith(17, { type: 'webpage:enable' });
  });

  it('关闭和查询状态不重复注入且保留结构化不可启用原因', async () => {
    const executeScript = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: { enabled: false, count: 0, reason: 'PAGE_NOT_ELIGIBLE' },
    });
    const api = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 17 }]),
        sendMessage,
      },
      scripting: { executeScript },
    };

    await expect(sendWebpageCommand('webpage:disable', api)).resolves.toMatchObject({
      reason: 'PAGE_NOT_ELIGIBLE',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it.each([
    'Cannot access a chrome:// URL',
    'The extensions gallery cannot be scripted',
    'Cannot access contents of url "https://chromewebstore.google.com/"',
  ])('受限页面注入错误映射为当前页面不支持：%s', async (message) => {
    const api = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 17 }]),
        sendMessage: vi.fn(),
      },
      scripting: {
        executeScript: vi.fn().mockRejectedValue(new Error(message)),
      },
    };

    await expect(sendWebpageCommand('webpage:enable', api)).rejects.toThrow(
      '当前页面不支持网页翻译',
    );
    expect(
      webpagePopupErrorText(new Error('当前页面不支持网页翻译')),
    ).toBe('当前页面不支持网页翻译');
    expect(
      webpagePopupErrorText(new Error('Provider unavailable')),
    ).toContain('请检查 Provider 设置后重试');
  });
});
