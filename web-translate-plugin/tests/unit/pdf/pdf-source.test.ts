import { describe, expect, it, vi } from 'vitest';

import { loadPdfSource } from '../../../src/pdf/pdf-source';

const pdf = new TextEncoder().encode('%PDF-1.7\nbody');

function response(bytes: Uint8Array, ok = true, headers: Record<string, string> = {}): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    headers: new Headers(headers),
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}

describe('PDF 源读取', () => {
  it('无凭据读取成功时分类为公共远程源并生成哈希', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(pdf));
    const loaded = await loadPdfSource('https://example.test/paper.pdf?x=1#p=2', fetcher);
    expect(loaded.descriptor).toMatchObject({ kind: 'remote', title: 'paper.pdf', size: pdf.length });
    expect(loaded.descriptor.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(loaded.bytes).toEqual(pdf);
    expect(loaded).not.toHaveProperty('bytesBase64');
    expect(fetcher).toHaveBeenCalledWith('https://example.test/paper.pdf?x=1#p=2', {
      credentials: 'omit', cache: 'no-store', signal: undefined,
    });
  });

  it('仅带凭据读取成功时保守分类为 authenticated', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(new Uint8Array(), false))
      .mockResolvedValueOnce(response(pdf));
    await expect(loadPdfSource('https://example.test/private.pdf', fetcher)).resolves.toMatchObject({ descriptor: { kind: 'authenticated' } });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'include' });
  });

  it('公共响应读取字节失败时继续尝试带凭据读取', async () => {
    const unreadable = { ...response(pdf), arrayBuffer: async () => { throw new Error('stream failed'); } } as Response;
    const fetcher = vi.fn().mockResolvedValueOnce(unreadable).mockResolvedValueOnce(response(pdf));
    await expect(loadPdfSource('https://example.test/private.pdf', fetcher))
      .resolves.toMatchObject({ descriptor: { kind: 'authenticated' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('优先使用响应头文件名，并为通用下载地址生成可识别标题', async () => {
    const named = vi.fn().mockResolvedValue(response(pdf, true, {
      'content-disposition': "attachment; filename*=UTF-8''Attention%20Paper.pdf",
    }));
    await expect(loadPdfSource('https://example.test/download?id=42', named))
      .resolves.toMatchObject({ descriptor: { title: 'Attention Paper.pdf' } });

    const fallback = vi.fn().mockResolvedValue(response(pdf));
    await expect(loadPdfSource('https://example.test/download?id=paper-42', fallback))
      .resolves.toMatchObject({ descriptor: { title: 'paper-42.pdf' } });
  });

  it('无凭据 200 HTML 后继续尝试凭据读取，只有认证响应真 PDF 才成功', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(new TextEncoder().encode('<html>login</html>')))
      .mockResolvedValueOnce(response(pdf));
    await expect(loadPdfSource('https://example.test/download?id=1', fetcher)).resolves.toMatchObject({ descriptor: { kind: 'authenticated' } });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const bothHtml = vi.fn().mockResolvedValue(response(new TextEncoder().encode('<html>login</html>')));
    await expect(loadPdfSource('https://example.test/download?id=1', bothHtml)).rejects.toMatchObject({ code: 'PDF_SIGNATURE_INVALID' });
  });

  it('拒绝 file、无效签名与双重读取失败且不回显正文', async () => {
    await expect(loadPdfSource('file:///tmp/p.pdf', vi.fn())).rejects.toMatchObject({ code: 'PDF_SOURCE_SCHEME' });
    await expect(loadPdfSource('https://x.test/p.pdf', vi.fn().mockResolvedValue(response(new TextEncoder().encode('secret'))))).rejects.toMatchObject({ code: 'PDF_SIGNATURE_INVALID' });
    await expect(loadPdfSource('https://x.test/p.pdf', vi.fn().mockResolvedValue(response(new Uint8Array(), false)))).rejects.toMatchObject({ code: 'PDF_FETCH_FAILED' });
  });

  it('36 MiB 级输入保留唯一二进制视图且不生成消息友好的字节副本', async () => {
    const large = new Uint8Array(36 * 1024 * 1024);
    large.set(new TextEncoder().encode('%PDF-'));
    large.fill(0x61, 5);
    const loaded = await loadPdfSource('https://x.test/large.pdf', vi.fn().mockResolvedValue(response(large)));
    expect(loaded.bytes.buffer).toBe(large.buffer);
    expect(loaded.descriptor.size).toBe(large.byteLength);
    expect(JSON.stringify(loaded.descriptor)).not.toMatch(/bytes|base64/i);
  });
});
