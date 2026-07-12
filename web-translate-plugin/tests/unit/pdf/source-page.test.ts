import { describe, expect, it } from 'vitest';

import { initialPageFromUrl } from '../../../src/pdf/source-page';

describe('PDF 初始页码', () => {
  it('从标准 page hash 读取正整数页码', () => {
    expect(initialPageFromUrl('https://arxiv.org/pdf/2401.00001#page=14')).toBe(14);
    expect(initialPageFromUrl('https://example.test/p.pdf#zoom=120&page=2')).toBe(2);
  });

  it('无效或缺失页码回退到第一页', () => {
    expect(initialPageFromUrl('https://example.test/p.pdf')).toBe(1);
    expect(initialPageFromUrl('https://example.test/p.pdf#page=0')).toBe(1);
    expect(initialPageFromUrl('not a url')).toBe(1);
  });
});
