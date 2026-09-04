import { describe, expect, it, vi } from 'vitest';
import { handlePdfReadingMessage } from '../../../src/pdf/reading-state-handler';

const url = 'https://x.test/p.pdf';
const sender = { tab: { id: 7 }, url, frameId: 0, documentId: 'doc-old' };
const message = { type: 'pdf:reading-save' as const, page: 40, progress: 0.2, scale: 1.1 };

function setup() {
  let current = true;
  const ports = {
    getTab: vi.fn().mockResolvedValue({ url }),
    status: vi.fn().mockResolvedValue(true),
    capture: vi.fn(() => () => current),
    store: { get: vi.fn().mockResolvedValue(null), savePosition: vi.fn().mockResolvedValue(undefined) },
  };
  return { ports, invalidate: () => { current = false; } };
}

describe('阅读消息文档身份与导航竞态', () => {
  it('主框架消息定向原 documentId 校验，并把有效性检查传入存储', async () => {
    const { ports } = setup();
    await handlePdfReadingMessage(message, sender, ports);
    expect(ports.status).toHaveBeenCalledWith(7, 'doc-old');
    expect(ports.store.savePosition).toHaveBeenCalledWith(url, message, expect.any(Function));
  });

  it.each([{ ...sender, documentId: undefined }, { ...sender, frameId: 2 }, { ...sender, url: 'https://evil.test/' }])('拒绝缺失身份/子框架/跨 URL', async (candidate) => {
    const { ports } = setup();
    await expect(handlePdfReadingMessage(message, candidate, ports)).rejects.toThrow('PDF_MESSAGE_SENDER_INVALID');
    expect(ports.store.savePosition).not.toHaveBeenCalled();
  });

  it.each(['pdf:reading-save', 'pdf:reading-get'] as const)('同 URL 导航发生在 status 等待期间，不允许旧 %s 被新页面放行', async (type) => {
    const { ports, invalidate } = setup();
    let release!: (mounted: boolean) => void;
    ports.status.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = handlePdfReadingMessage(type === 'pdf:reading-save' ? message : { type }, sender, ports);
    const rejected = expect(pending).rejects.toThrow('PDF_MESSAGE_SENDER_INVALID');
    await Promise.resolve();
    invalidate();
    release(true);
    await rejected;
    expect(ports.store.savePosition).not.toHaveBeenCalled();
    expect(ports.store.get).not.toHaveBeenCalled();
  });
});
