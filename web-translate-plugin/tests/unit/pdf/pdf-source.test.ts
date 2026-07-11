import { describe, expect, it, vi } from 'vitest';

import { loadPdfSource } from '../../../src/pdf/pdf-source';

const pdf = new TextEncoder().encode('%PDF-1.7\nbody');

function response(bytes: Uint8Array, ok = true): Response {
  return { ok, status: ok ? 200 : 401, arrayBuffer: async () => bytes.buffer } as Response;
}

describe('PDF 源读取', () => {
  it('无凭据读取成功时分类为公共远程源并生成哈希', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(pdf));
    const source = await loadPdfSource('https://example.test/paper.pdf?x=1#p=2', fetcher);
    expect(source).toMatchObject({ kind: 'remote', title: 'paper.pdf', size: pdf.length });
    expect(source.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/paper.pdf?x=1#p=2', {
      credentials: 'omit', cache: 'no-store', signal: undefined,
    });
  });

  it('仅带凭据读取成功时保守分类为 authenticated', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(new Uint8Array(), false))
      .mockResolvedValueOnce(response(pdf));
    await expect(loadPdfSource('https://example.test/private.pdf', fetcher)).resolves.toMatchObject({ kind: 'authenticated' });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'include' });
  });

  it('无凭据 200 HTML 后继续尝试凭据读取，只有认证响应真 PDF 才成功', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(new TextEncoder().encode('<html>login</html>')))
      .mockResolvedValueOnce(response(pdf));
    await expect(loadPdfSource('https://example.test/download?id=1', fetcher)).resolves.toMatchObject({ kind: 'authenticated' });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const bothHtml = vi.fn().mockResolvedValue(response(new TextEncoder().encode('<html>login</html>')));
    await expect(loadPdfSource('https://example.test/download?id=1', bothHtml)).rejects.toMatchObject({ code: 'PDF_SIGNATURE_INVALID' });
  });

  it('拒绝 file、无效签名与双重读取失败且不回显正文', async () => {
    await expect(loadPdfSource('file:///tmp/p.pdf', vi.fn())).rejects.toMatchObject({ code: 'PDF_SOURCE_SCHEME' });
    await expect(loadPdfSource('https://x.test/p.pdf', vi.fn().mockResolvedValue(response(new TextEncoder().encode('secret'))))).rejects.toMatchObject({ code: 'PDF_SIGNATURE_INVALID' });
    await expect(loadPdfSource('https://x.test/p.pdf', vi.fn().mockResolvedValue(response(new Uint8Array(), false)))).rejects.toMatchObject({ code: 'PDF_FETCH_FAILED' });
  });
});
