import { describe, expect, it, vi } from 'vitest';

import { PdfRenderQueue } from '../../../src/pdf/pdf-render-queue';

describe('PDF 渲染优先级队列', () => {
  it('最多并发两个任务并优先放行当前可见页', async () => {
    const queue = new PdfRenderQueue(2);
    const first = await queue.acquire('near-preview');
    const second = await queue.acquire('idle-preview');
    const order: string[] = [];
    const idle = queue.acquire('idle-preview').then((release) => { order.push('idle'); return release; });
    const visible = queue.acquire('visible-final').then((release) => { order.push('visible'); return release; });

    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(2);
    first();
    const visibleRelease = await visible;
    expect(order).toEqual(['visible']);
    expect(queue.activeCount).toBe(2);
    visibleRelease();
    const idleRelease = await idle;
    idleRelease();
    second();
    expect(queue.activeCount).toBe(0);
  });

  it('等待中的过期任务可以取消且不占并发槽', async () => {
    const queue = new PdfRenderQueue(1);
    const release = await queue.acquire('visible-final');
    const controller = new AbortController();
    const waiting = queue.acquire('near-preview', controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(queue.pendingCount).toBe(0);
    release();
    expect(queue.activeCount).toBe(0);
  });

  it('release 重复调用也只释放一次', async () => {
    const queue = new PdfRenderQueue(1);
    const release = await queue.acquire('visible-final');
    const next = vi.fn();
    const waiting = queue.acquire('near-preview').then((nextRelease) => {
      next();
      nextRelease();
    });
    release();
    release();
    await waiting;
    expect(next).toHaveBeenCalledOnce();
    expect(queue.activeCount).toBe(0);
  });
});
