import { describe, expect, it, vi } from 'vitest';

import { ChromePdfTakeoverAdapter } from '../../../src/pdf/takeover-port';

describe('正式 PDF 接管端口', () => {
  const insertCSS = () => vi.fn().mockResolvedValue(undefined);

  it('注入固定 runtime bundle 且 URL 必须逐字不变', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ url: 'https://x.test/p.pdf?q=1#page=2' })
      .mockResolvedValueOnce({ url: 'https://x.test/p.pdf?q=1#page=2' });
    const injectStyle = insertCSS();
    const executeScript = vi.fn().mockResolvedValue([]);
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get, sendMessage: vi.fn(), reload: vi.fn() }, scripting: { insertCSS: injectStyle, executeScript } });
    await expect(adapter.mount(7)).resolves.toEqual({ originalUrl: 'https://x.test/p.pdf?q=1#page=2' });
    expect(injectStyle).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['/content-scripts/pdf-workspace.css'] });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['/content-scripts/pdf-workspace.js'] });
    expect(injectStyle.mock.invocationCallOrder[0]).toBeLessThan(executeScript.mock.invocationCallOrder[0]);
  });

  it('URL 变化会失败，关闭通过内容脚本恢复而不是伪造导航', async () => {
    const get = vi.fn().mockResolvedValueOnce({ url: 'https://x.test/p.pdf' }).mockResolvedValueOnce({ url: 'https://x.test/changed.pdf' });
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get, sendMessage: vi.fn(), reload: vi.fn() }, scripting: { insertCSS: insertCSS(), executeScript: vi.fn() } });
    await expect(adapter.mount(7)).rejects.toThrow('PDF_URL_CHANGED');

    const sendMessage = vi.fn().mockResolvedValue({ ok: true, value: { enabled: false } });
    const reload = vi.fn().mockResolvedValue(undefined);
    const restore = new ChromePdfTakeoverAdapter({ tabs: { get: vi.fn().mockResolvedValue({ url: 'https://x.test/p.pdf' }), sendMessage, reload }, scripting: { insertCSS: insertCSS(), executeScript: vi.fn() } });
    await expect(restore.restore(7)).resolves.toEqual({ restored: true, url: 'https://x.test/p.pdf' });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'pdf-workspace:disable' });
    expect(reload).toHaveBeenCalledWith(7);
  });

  it('worker 重启后通过 content runtime 实时 status 判断 mounted 并可关闭', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { enabled: true } })
      .mockResolvedValueOnce({ ok: true, value: { enabled: false } });
    const reload = vi.fn();
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get: vi.fn().mockResolvedValue({ url: 'https://x.test/download?id=1' }), sendMessage, reload }, scripting: { insertCSS: insertCSS(), executeScript: vi.fn() } });
    await expect(adapter.status(9)).resolves.toBe(true);
    await expect(adapter.restore(9)).resolves.toMatchObject({ restored: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('activeTab 探测 document.contentType 支持通用 PDF URL 并拒绝 HTML', async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{ result: 'application/pdf' }])
      .mockResolvedValueOnce([{ result: 'text/html' }]);
    const adapter = new ChromePdfTakeoverAdapter({ tabs: { get: vi.fn(), sendMessage: vi.fn(), reload: vi.fn() }, scripting: { insertCSS: insertCSS(), executeScript } });
    await expect(adapter.probePdfContentType(9)).resolves.toBe(true);
    await expect(adapter.probePdfContentType(9)).resolves.toBe(false);
  });
});
