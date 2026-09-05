import { describe, expect, it, vi } from 'vitest';
import { PdfReadingStateStore, pdfReadingIdentity, isPdfReadingMessage } from '../../../src/pdf/reading-state';
import { initialPageFromUrl } from '../../../src/pdf/source-page';
import { requestPdfResumePermission } from '../../../src/pdf/popup-client';

describe('PDF 阅读状态', () => {
  it('存储读取期间导航失效时，不提交旧文档位置', async () => {
    let release!: (data: Record<string, unknown>) => void;
    let current = true;
    const local = { get: vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { release = resolve; })), set: vi.fn() };
    const store = new PdfReadingStateStore(local);
    const pending = store.savePosition('https://x.test/p.pdf', { page: 40, progress: 0.2, scale: 1.1 }, () => current);
    await vi.waitFor(() => expect(local.get).toHaveBeenCalledOnce());
    current = false;
    release({});
    await pending;
    expect(local.set).not.toHaveBeenCalled();
  });
  it('普通 URL 保留查询隔离、去除片段；arXiv PDF 保留版本且不接管摘要页', () => {
    expect(pdfReadingIdentity('https://x.test/get?id=1#page=4')).toBe('https://x.test/get?id=1');
    expect(pdfReadingIdentity('https://x.test/get?id=2')).not.toBe(pdfReadingIdentity('https://x.test/get?id=1'));
    expect(pdfReadingIdentity('https://arxiv.org/pdf/2510.12403v2.pdf?q=1#page=3')).toBe('arxiv:2510.12403v2');
    expect(pdfReadingIdentity('https://arxiv.org/pdf/2510.12403v1')).not.toBe(pdfReadingIdentity('https://arxiv.org/pdf/2510.12403v2'));
    for (const url of ['file:///p.pdf', 'https://arxiv.org/abs/2510.12403', 'javascript:alert(1)', 'https://u:p@x.test/p.pdf']) expect(pdfReadingIdentity(url)).toBeNull();
  });

  it('跨实例恢复；并发写位置不会丢失关闭状态，存储不含原始签名 URL', async () => {
    const data: Record<string, unknown> = {};
    const local = { get: vi.fn(async (key: string) => ({ [key]: data[key] })), set: vi.fn(async (items) => { Object.assign(data, items); }) };
    const store = new PdfReadingStateStore(local);
    const url = 'https://x.test/get?signature=private&id=1#page=3';
    await store.setEnabled(url, true);
    await store.savePosition(url, { page: 40, progress: 0.37, scale: 1.8 });
    await expect(new PdfReadingStateStore(local).get(url)).resolves.toMatchObject({ enabled: true, page: 40, progress: 0.37, scale: 1.8 });
    await Promise.all([store.setEnabled(url, false), store.savePosition(url, { page: 41, progress: 0.5, scale: 1.8 })]);
    await expect(store.get(url)).resolves.toMatchObject({ enabled: false, page: 41 });
    expect(JSON.stringify(data)).not.toContain('signature');
    expect(Object.keys(data)[0]).toMatch(/^pdf-reading-v1:[a-f0-9]{64}$/);
    await expect(store.get('https://x.test/get?id=2')).resolves.toBeNull();
  });

  it('读取损坏记录回退，不接受越界或额外 URL 字段', async () => {
    const store = new PdfReadingStateStore({ get: async (key) => ({ [key]: { enabled: true, page: -1 } }), set: vi.fn() });
    await expect(store.get('https://x.test/p.pdf')).resolves.toBeNull();
    expect(isPdfReadingMessage({ type: 'pdf:reading-get' })).toBe(true);
    expect(isPdfReadingMessage({ type: 'pdf:reading-get', url: 'https://evil.test/' })).toBe(false);
    expect(isPdfReadingMessage({ type: 'pdf:reading-save', page: 4, progress: 0.2, scale: 1.1 })).toBe(true);
    for (const progress of [-1, 2, Infinity, NaN]) expect(isPdfReadingMessage({ type: 'pdf:reading-save', page: 4, progress, scale: 1.1 })).toBe(false);
  });

  it('显式页码优先，否则使用记忆页码', () => {
    expect(initialPageFromUrl('https://x.test/p.pdf', 40)).toBe(40);
    expect(initialPageFromUrl('https://x.test/p.pdf#page=2', 40)).toBe(2);
    expect(initialPageFromUrl('https://x.test/p.pdf#page=0', 40)).toBe(40);
    expect(initialPageFromUrl('https://x.test/p.pdf', 0)).toBe(0);
  });

  it('只请求当前站点权限且拒绝时返回 false，不申请所有网站', async () => {
    const request = vi.fn().mockResolvedValue(false);
    await expect(requestPdfResumePermission('https://x.test/p.pdf', { request })).resolves.toBe(false);
    expect(request).toHaveBeenCalledWith({ origins: ['https://x.test/*'] });
    await expect(requestPdfResumePermission('file:///p.pdf', { request })).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
