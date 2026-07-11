import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { loadMineruResult } from '../../../../src/providers/mineru/result-loader';

const metadata = {
  sourceUrl: 'https://example.test/p.pdf',
  hash: 'sha256:x',
  title: 'P',
  pageCount: 1,
};

describe('MinerU Zip 结果加载', () => {
  it('允许目录前缀并生成文档模型', async () => {
    const zip = zipSync({
      'nested/paper_content_list.json': strToU8(JSON.stringify([{ page_idx: 0, type: 'text', text: 'Hello' }])),
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(zip, { status: 200 }));
    const model = await loadMineruResult('https://cdn.test/result.zip', metadata, fetcher);
    expect(model.pages[0].blocks[0].text).toBe('Hello');
  });

  it.each([
    ['缺失内容列表', zipSync({ 'readme.txt': strToU8('empty') }), 'MINERU_CONTENT_LIST_MISSING'],
    ['重复内容列表', zipSync({
      'a_content_list.json': strToU8('[]'),
      'nested/b_content_list.json': strToU8('[]'),
    }), 'MINERU_CONTENT_LIST_DUPLICATE'],
    ['非数组 JSON', zipSync({ 'paper_content_list.json': strToU8('{}') }), 'MINERU_CONTENT_LIST_INVALID'],
    ['损坏 Zip', new Uint8Array([1, 2, 3]), 'MINERU_ZIP_INVALID'],
  ])('%s 时抛出结构化错误', async (_name, bytes, code) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    await expect(loadMineruResult('https://cdn.test/result.zip', metadata, fetcher)).rejects.toMatchObject({ code });
  });

  it('网络失败不读取或回显响应正文', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret raw body', { status: 502 }));
    try {
      await loadMineruResult('https://cdn.test/result.zip', metadata, fetcher);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 'MINERU_RESULT_HTTP' });
      expect(String(error)).not.toContain('secret raw body');
    }
  });
});
