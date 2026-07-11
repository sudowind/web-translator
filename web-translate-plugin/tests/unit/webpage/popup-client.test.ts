import { describe, expect, it, vi } from 'vitest';

import { sendWebpageCommand } from '../../../src/webpage/popup-client';

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
});
