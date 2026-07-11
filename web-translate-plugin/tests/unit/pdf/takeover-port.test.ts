import { describe, expect, it, vi } from 'vitest';

import { ChromePdfTakeoverAdapter } from '../../../src/pdf/takeover-port';

describe('正式 PDF 接管端口', () => {
  it('注入固定 runtime bundle 且 URL 必须逐字不变', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ url: 'https://x.test/p.pdf?q=1#page=2' })
      .mockResolvedValueOnce({ url: 'https://x.test/p.pdf?q=1#page=2' });
    const executeScript = vi.fn().mockResolvedValue([]);
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get, sendMessage: vi.fn(), reload: vi.fn() }, scripting: { executeScript } });
    await expect(adapter.mount(7)).resolves.toEqual({ originalUrl: 'https://x.test/p.pdf?q=1#page=2' });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['/content-scripts/pdf-workspace.js'] });
  });

  it('URL 变化会失败，关闭通过内容脚本恢复而不是伪造导航', async () => {
    const get = vi.fn().mockResolvedValueOnce({ url: 'https://x.test/p.pdf' }).mockResolvedValueOnce({ url: 'https://x.test/changed.pdf' });
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get, sendMessage: vi.fn(), reload: vi.fn() }, scripting: { executeScript: vi.fn() } });
    await expect(adapter.mount(7)).rejects.toThrow('PDF_URL_CHANGED');

    const sendMessage = vi.fn().mockResolvedValue({ ok: true, value: { enabled: false } });
    const reload = vi.fn().mockResolvedValue(undefined);
    const restore = new ChromePdfTakeoverAdapter({ tabs: { get: vi.fn().mockResolvedValue({ url: 'https://x.test/p.pdf' }), sendMessage, reload }, scripting: { executeScript: vi.fn() } });
    await expect(restore.restore(7)).resolves.toEqual({ restored: true, url: 'https://x.test/p.pdf' });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'pdf-workspace:disable' });
    expect(reload).toHaveBeenCalledWith(7);
  });
});
