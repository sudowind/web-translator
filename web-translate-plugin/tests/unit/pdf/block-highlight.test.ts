import { describe, expect, it } from 'vitest';

import { mineruPolygonToPercentRect } from '../../../src/pdf/block-highlight';

describe('MinerU 区块坐标转换', () => {
  it('把四值 bbox 转换为百分比矩形', () => {
    expect(mineruPolygonToPercentRect([100, 200, 700, 800])).toEqual({
      left: 10, top: 20, width: 60, height: 60,
    });
  });

  it('把八值 polygon 收敛为包围矩形', () => {
    expect(mineruPolygonToPercentRect([700, 200, 700, 800, 100, 800, 100, 200])).toEqual({
      left: 10, top: 20, width: 60, height: 60,
    });
  });

  it.each([
    undefined,
    [],
    [0, 0, 1001, 10],
    [10, 10, 10, 20],
    [10, 10, Number.NaN, 20],
    [1, 2, 3, 4, 5, 6],
  ])('非法或退化坐标返回 null：%j', (value) => {
    expect(mineruPolygonToPercentRect(value)).toBeNull();
  });
});
