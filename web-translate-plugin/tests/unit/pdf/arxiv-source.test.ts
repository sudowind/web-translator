import { describe, expect, it, vi } from 'vitest';

import { arxivSourceKeyMatches, readArxivSourceRevision, resolveArxivSource, samePdfSource } from '../../../src/pdf/arxiv-source';

describe('arXiv PDF 文档身份', () => {
  it.each([
    'https://arxiv.org/abs/2510.12403',
    'https://arxiv.org/pdf/2510.12403',
    'https://arxiv.org/pdf/2510.12403.pdf?download=1#page=3',
    'https://www.arxiv.org/pdf/2510.12403',
    'https://export.arxiv.org/abs/2510.12403',
  ])('把等价现代 URL 规范化为同一文档：%s', (url) => {
    expect(resolveArxivSource(url)).toEqual({
      id: '2510.12403',
      key: 'arxiv:2510.12403',
      pdfUrl: 'https://arxiv.org/pdf/2510.12403',
      title: '2510.12403.pdf',
      version: null,
    });
  });

  it('修订探测只发送 HEAD，优先使用 ETag 且不读取正文', async () => {
    const arrayBuffer = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ etag: '"v3"', 'content-length': '123' }),
      arrayBuffer,
    });
    await expect(readArxivSourceRevision('https://arxiv.org/pdf/2510.12403', fetcher)).resolves.toBe('etag:"v3"');
    expect(fetcher).toHaveBeenCalledWith('https://arxiv.org/pdf/2510.12403', {
      method: 'HEAD', credentials: 'omit', cache: 'no-cache', redirect: 'follow', signal: expect.any(AbortSignal),
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('HEAD 挂起时在两秒内退化为未知修订', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
    })) as unknown as typeof fetch;
    try {
      const revision = readArxivSourceRevision('https://arxiv.org/pdf/2510.12403', fetcher);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(revision).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('版本与旧式 ID 保留在缓存键中', () => {
    expect(resolveArxivSource('https://arxiv.org/pdf/2510.12403v2.pdf')).toMatchObject({
      id: '2510.12403v2', key: 'arxiv:2510.12403v2', version: 2,
    });
    expect(resolveArxivSource('https://arxiv.org/abs/hep-th/9901001v1')).toMatchObject({
      id: 'hep-th/9901001v1', key: 'arxiv:hep-th/9901001v1', version: 1,
      pdfUrl: 'https://arxiv.org/pdf/hep-th/9901001v1',
    });
  });

  it('发送者校验只允许精确 URL 或同一 arXiv 身份', () => {
    expect(samePdfSource(
      'https://arxiv.org/pdf/2510.12403',
      'https://www.arxiv.org/abs/2510.12403.pdf#page=3',
    )).toBe(true);
    expect(samePdfSource('https://arxiv.org/pdf/2510.12403v1', 'https://arxiv.org/pdf/2510.12403v2')).toBe(false);
    expect(samePdfSource('https://example.test/a.pdf', 'https://example.test/b.pdf')).toBe(false);
    expect(arxivSourceKeyMatches('https://arxiv.org/pdf/2510.12403v2', 'arxiv:2510.12403v2')).toBe(true);
    expect(arxivSourceKeyMatches('https://arxiv.org/pdf/2510.12403v2', 'arxiv:2510.12403v1')).toBe(false);
  });

  it.each([
    'https://arxiv.org.evil.test/pdf/2510.12403',
    'https://arxiv.org/help/2510.12403',
    'https://arxiv.org/pdf/2510.12403/extra',
    'https://arxiv.org/pdf/2599.0001',
    'https://arxiv.org/pdf/2510.0000',
    'https://arxiv.org/pdf/hep-th/9999000',
    'https://example.test/pdf/2510.12403',
    'file:///2510.12403.pdf',
  ])('拒绝非 arXiv 或非法地址：%s', (url) => {
    expect(resolveArxivSource(url)).toBeNull();
  });
});
