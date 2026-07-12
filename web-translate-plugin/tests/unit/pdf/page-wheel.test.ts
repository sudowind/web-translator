import { describe, expect, it } from 'vitest';

import { pageWheelAction } from '../../../src/pdf/page-wheel';

describe('译文页内滚动边界', () => {
  it('页内仍可滚动时保留在当前页', () => {
    expect(pageWheelAction({ scrollTop: 40, clientHeight: 300, scrollHeight: 900 }, 100)).toBe('inner');
    expect(pageWheelAction({ scrollTop: 40, clientHeight: 300, scrollHeight: 900 }, -100)).toBe('inner');
  });

  it('到达上下边界后把滚动交给相邻页', () => {
    expect(pageWheelAction({ scrollTop: 600, clientHeight: 300, scrollHeight: 900 }, 100)).toBe('next');
    expect(pageWheelAction({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 }, -100)).toBe('previous');
  });
});
