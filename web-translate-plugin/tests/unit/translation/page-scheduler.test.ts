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
    expect(scheduler.retry(1)).toBe(true);
    expect(scheduler.retry(3)).toBe(false);
    scheduler.markDone(2);
    expect(scheduler.take()).toBe(1);
    scheduler.markDone(1);
    expect(scheduler.take()).toBe(3);
  });

  it('按需模式只派发当前阅读窗口并按方向排序', () => {
    const scheduler = new PageScheduler(76, 2, 'on-demand');
    expect(scheduler.requestWindow(40, 1)).toEqual([40, 41, 42, 39]);
    expect([scheduler.take(), scheduler.take(), scheduler.take()]).toEqual([40, 41, null]);
    scheduler.markDone(40);
    expect(scheduler.take()).toBe(42);
    scheduler.markDone(41);
    expect(scheduler.take()).toBe(39);
  });

  it('按需窗口裁剪边界、去重并跳过缓存页', () => {
    const scheduler = new PageScheduler(3, 2, 'on-demand');
    scheduler.hydrateDone([1, 2]);
    expect(scheduler.isCached(1)).toBe(true);
    expect(scheduler.requestWindow(1, 0)).toEqual([1, 2, 3]);
    expect(scheduler.take()).toBe(3);
    expect(scheduler.take()).toBeNull();
  });

  it('模式切换不取消进行中页面且全文模式继续顺序派发', () => {
    const scheduler = new PageScheduler(5, 1, 'on-demand');
    scheduler.requestPage(4);
    expect(scheduler.take()).toBe(4);
    scheduler.setMode('full-document');
    expect(scheduler.take()).toBeNull();
    scheduler.markDone(4);
    expect(scheduler.take()).toBe(1);
    scheduler.setMode('on-demand');
    scheduler.markDone(1);
    expect(scheduler.take()).toBeNull();
  });

  it('新显式导航清除旧预取队列并在并发释放后首先派发目标页', () => {
    const scheduler = new PageScheduler(76, 1, 'on-demand');
    scheduler.requestWindow(10, 1);
    expect(scheduler.take()).toBe(10);
    scheduler.requestNavigationWindow(50, 1);
    scheduler.markDone(10);
    expect(scheduler.take()).toBe(50);
    scheduler.markDone(50);
    expect(scheduler.take()).toBe(51);
    expect([9, 11, 12].some((page) => scheduler.isCached(page))).toBe(false);
  });

  it('350ms 后同页稳定窗口不会降低仍在等待的显式导航优先级', () => {
    const scheduler = new PageScheduler(76, 1, 'on-demand');
    scheduler.requestWindow(1);
    expect(scheduler.take()).toBe(1);
    scheduler.requestNavigationWindow(50);
    scheduler.requestWindow(50);
    scheduler.requestPage(70, -150);
    scheduler.markDone(1);
    expect(scheduler.take()).toBe(50);
  });
});
