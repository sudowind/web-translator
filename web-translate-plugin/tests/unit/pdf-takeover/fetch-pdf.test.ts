import { describe, expect, it, vi } from 'vitest';

import { readPdfBytes } from '../../../src/pdf-takeover/fetch-pdf';

function responseWith(bytes: number[], ok = true): Response {
  return {
    ok,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as Response;
}

describe('readPdfBytes', () => {
  it('有效 PDF 签名返回 true 并使用凭据与禁用缓存', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      responseWith(Array.from(new TextEncoder().encode('%PDF-1.7'))),
    );

    await expect(readPdfBytes('https://example.com/paper.pdf', fetcher)).resolves.toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledWith('https://example.com/paper.pdf', {
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('非成功 HTTP 响应返回 false', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => responseWith([], false));

    await expect(readPdfBytes('https://example.com/paper.pdf', fetcher)).resolves.toBe(
      false,
    );
  });

  it('少于五字节返回 false', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      responseWith(Array.from(new TextEncoder().encode('%PDF'))),
    );

    await expect(readPdfBytes('https://example.com/paper.pdf', fetcher)).resolves.toBe(
      false,
    );
  });

  it('签名错误返回 false', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      responseWith(Array.from(new TextEncoder().encode('NOT-PDF'))),
    );

    await expect(readPdfBytes('https://example.com/paper.pdf', fetcher)).resolves.toBe(
      false,
    );
  });
});
