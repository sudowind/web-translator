import { describe, expect, it } from 'vitest';

import { PageScheduler } from '../../../src/translation/page-scheduler';

describe('逐页翻译调度器', () => {
  it('当前页优先，其余按页距排序且不重复出队', () => {
    const scheduler = new PageScheduler(6, 2);
    scheduler.setActivePage(3);
    expect([scheduler.take(), scheduler.take(), scheduler.take()]).toEqual([3, 2, null]);
    scheduler.markDone(3);
    expect(scheduler.take()).toBe(4);
    scheduler.markFailed(2);
    expect(scheduler.take()).toBe(1);
  });

  it('活动页改变后重排尚未开始的页面并允许显式重试', () => {
    const scheduler = new PageScheduler(5, 2);
    scheduler.setActivePage(1);
    expect(scheduler.take()).toBe(1);
    scheduler.setActivePage(5);
    expect(scheduler.take()).toBe(5);
    scheduler.markFailed(1);
    scheduler.retry(1);
    scheduler.markDone(5);
    expect(scheduler.take()).toBe(4);
  });
});
