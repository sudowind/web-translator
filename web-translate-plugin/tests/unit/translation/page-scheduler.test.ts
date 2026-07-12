import { describe, expect, it } from 'vitest';

import { PageScheduler } from '../../../src/translation/page-scheduler';

describe('逐页翻译调度器', () => {
  it('按页码顺序派发且不超过并发上限', () => {
    const scheduler = new PageScheduler(5, 2);
    (scheduler as unknown as { setActivePage?(page: number): void }).setActivePage?.(4);
    expect([scheduler.take(), scheduler.take(), scheduler.take()]).toEqual([1, 2, null]);
    scheduler.markDone(2);
    expect(scheduler.take()).toBe(3);
    scheduler.markDone(1);
    expect(scheduler.take()).toBe(4);
  });

  it('失败页不阻塞后续页且只有失败页可以显式重试', () => {
    const scheduler = new PageScheduler(4, 1);
    expect(scheduler.take()).toBe(1);
    scheduler.markFailed(1);
    expect(scheduler.take()).toBe(2);
    scheduler.retry(1);
    scheduler.retry(3);
    scheduler.markDone(2);
    expect(scheduler.take()).toBe(1);
    scheduler.markDone(1);
    expect(scheduler.take()).toBe(3);
  });
});
