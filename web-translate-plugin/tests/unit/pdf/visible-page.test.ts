import { describe, expect, it } from 'vitest';

import { selectDominantPage } from '../../../src/pdf/visible-page';

describe('主要可见 PDF 页面', () => {
  it('选择交叉面积最大的页面', () => {
    expect(selectDominantPage([
      { page: 2, intersectionRatio: 0.35 },
      { page: 3, intersectionRatio: 0.72 },
    ], 2)).toBe(3);
  });

  it('面积相同时保持当前页，否则使用较小页码保证确定性', () => {
    expect(selectDominantPage([
      { page: 2, intersectionRatio: 0.5 },
      { page: 3, intersectionRatio: 0.5 },
    ], 2)).toBe(2);
    expect(selectDominantPage([
      { page: 4, intersectionRatio: 0.5 },
      { page: 3, intersectionRatio: 0.5 },
    ], 2)).toBe(3);
  });
});
