// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pdf/PdfTextLayer', () => ({ PdfTextLayer: () => null }));

import { PdfPageCanvas } from '../../../src/pdf/PdfViewer';

function installResizeObserver(): () => void {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as typeof ResizeObserver;
  return () => { globalThis.ResizeObserver = previous; };
}

function createPage(renderPromises: Promise<void>[]) {
  const cancelFunctions = renderPromises.map(() => vi.fn());
  const cleanup = vi.fn();
  let renderIndex = 0;
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(() => {
      const index = renderIndex++;
      return { promise: renderPromises[index], cancel: cancelFunctions[index] };
    }),
    cleanup,
  };
  return { page, cancelFunctions, cleanup };
}

describe('PDF Canvas 清晰帧生命周期', () => {
  it('后台帧完成前不展示半成品，完成后原子切换为清晰前台帧', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let settleRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { settleRender = resolve; });
    const { page } = createPage([renderPromise]);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const restoreResizeObserver = installResizeObserver();
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<PdfPageCanvas document={pdf as never} page={page as never} pageNumber={1} scale={1} displayWidth={600} />);
        await Promise.resolve();
      });
      const buffers = Array.from(container.querySelectorAll<HTMLCanvasElement>('[data-pdf-canvas-buffer]'));
      expect(buffers).toHaveLength(2);
      expect(buffers.filter((canvas) => canvas.dataset.active === 'true')).toHaveLength(0);

      settleRender();
      await act(async () => { await renderPromise; });

      const active = buffers.filter((canvas) => canvas.dataset.active === 'true');
      expect(active).toHaveLength(1);
      expect(active[0].style.width).toBe('600px');
      expect(active[0].width).toBeGreaterThanOrEqual(600);
      expect(container.querySelector('.pdf-page-canvas-wrap')?.getAttribute('data-rendering')).toBe('false');
    } finally {
      await act(async () => root.unmount());
      restoreResizeObserver();
    }
  });

  it('放大期间保留旧帧原始 CSS 尺寸，最新后台帧完成后才替换', async () => {
    let settleFirst!: () => void;
    let settleSecond!: () => void;
    const first = new Promise<void>((resolve) => { settleFirst = resolve; });
    const second = new Promise<void>((resolve) => { settleSecond = resolve; });
    const { page } = createPage([first, second]);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const restoreResizeObserver = installResizeObserver();
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<PdfPageCanvas document={pdf as never} page={page as never} pageNumber={1} scale={1} displayWidth={600} />);
        await Promise.resolve();
      });
      settleFirst();
      await act(async () => { await first; });
      const firstActive = container.querySelector<HTMLCanvasElement>('[data-active="true"]')!;
      expect(firstActive.style.width).toBe('600px');

      await act(async () => {
        root.render(<PdfPageCanvas document={pdf as never} page={page as never} pageNumber={1} scale={2} displayWidth={1200} />);
        await Promise.resolve();
      });
      expect(container.querySelector<HTMLCanvasElement>('[data-active="true"]')).toBe(firstActive);
      expect(firstActive.style.width).toBe('600px');
      expect(container.querySelector<HTMLElement>('.pdf-page-canvas-wrap')!.style.width).toBe('1200px');

      settleSecond();
      await act(async () => { await second; });
      const secondActive = container.querySelector<HTMLCanvasElement>('[data-active="true"]')!;
      expect(secondActive).not.toBe(firstActive);
      expect(secondActive.style.width).toBe('1200px');
      expect(firstActive.width).toBe(0);
    } finally {
      await act(async () => root.unmount());
      restoreResizeObserver();
    }
  });

  it('页面从当前页退为相邻页时保留已完成的高质量帧而不降级重绘', async () => {
    const { page } = createPage([Promise.resolve()]);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const restoreResizeObserver = installResizeObserver();
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<PdfPageCanvas
          document={pdf as never}
          page={page as never}
          pageNumber={1}
          scale={1}
          displayWidth={600}
          maximumOutputScale={2}
          renderPriority="visible-final"
        />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(page.render).toHaveBeenCalledOnce();

      await act(async () => {
        root.render(<PdfPageCanvas
          document={pdf as never}
          page={page as never}
          pageNumber={1}
          scale={1}
          displayWidth={600}
          maximumOutputScale={1.25}
          renderPriority="near-preview"
        />);
        await Promise.resolve();
      });
      expect(page.render).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      restoreResizeObserver();
    }
  });

  it('离开渲染窗口时取消后台任务并清空两个 Canvas，任务结束后再 cleanup 页面', async () => {
    let settleRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { settleRender = resolve; });
    const { page, cancelFunctions, cleanup } = createPage([renderPromise]);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const restoreResizeObserver = installResizeObserver();
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<PdfPageCanvas document={pdf as never} pageNumber={1} scale={1} />);
        await Promise.resolve();
      });
      const canvases = Array.from(container.querySelectorAll('canvas'));
      expect(page.render).toHaveBeenCalledOnce();

      await act(async () => root.unmount());
      expect(cancelFunctions[0]).toHaveBeenCalledOnce();
      expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
      expect(cleanup).not.toHaveBeenCalled();

      settleRender();
      await act(async () => { await renderPromise; });
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      restoreResizeObserver();
    }
  });
});
