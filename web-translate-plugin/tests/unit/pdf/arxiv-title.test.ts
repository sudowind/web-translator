import { expect, it, vi } from 'vitest';
import { readArxivTitle } from '../../../src/pdf/arxiv-title';

it('使用官方引用元数据，核对论文编号并解码标题', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<head><meta name="citation_title" content="Robot Learning: A Tutorial &amp; Examples" /><meta name="citation_arxiv_id" content="2510.12403" /></head>'));
  expect(await readArxivTitle('https://arxiv.org/pdf/2510.12403#page=73', fetcher)).toBe('Robot Learning: A Tutorial & Examples');
  expect(fetcher).toHaveBeenCalledWith('https://arxiv.org/abs/2510.12403', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
});
it('拒绝非 arXiv 地址、错配编号、超大响应和网络故障', async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(await readArxivTitle('https://evil.test/pdf/2510.12403', fetcher)).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
  for (const body of ['<meta name="citation_title" content="Wrong Paper"><meta name="citation_arxiv_id" content="2510.99999">', 'x'.repeat(256001)]) {
    fetcher.mockResolvedValueOnce(new Response(body));
    expect(await readArxivTitle('https://arxiv.org/pdf/2510.12403', fetcher)).toBeUndefined();
  }
  fetcher.mockRejectedValueOnce(new Error('offline'));
  expect(await readArxivTitle('https://arxiv.org/pdf/2510.12403', fetcher)).toBeUndefined();
});
