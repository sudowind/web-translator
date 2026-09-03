// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pdf/PdfTextLayer', () => ({ PdfTextLayer: () => null }));

import { PdfPageCanvas } from '../../../src/pdf/PdfViewer';

describe('PDF Canvas 资源生命周期', () => {
  it('离开渲染窗口时先取消任务和清空 Canvas，任务结束后再 cleanup 页面', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let settleRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { settleRender = resolve; });
    const cancel = vi.fn();
    const cleanup = vi.fn();
    const page = {
      getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
      render: vi.fn().mockReturnValue({ promise: renderPromise, cancel }),
      cleanup,
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const previousResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<PdfPageCanvas document={pdf as never} pageNumber={1} scale={1} />);
        await Promise.resolve();
      });
      const canvas = container.querySelector('canvas')!;
      expect(page.render).toHaveBeenCalledOnce();

      await act(async () => root.unmount());
      expect(cancel).toHaveBeenCalledOnce();
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(cleanup).not.toHaveBeenCalled();

      settleRender();
      await act(async () => { await renderPromise; });
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      globalThis.ResizeObserver = previousResizeObserver;
    }
  });
});
