// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { PdfBlockHighlightLayer } from '../../../src/pdf/PdfBlockHighlightLayer';
import { PdfTextLayer, type TextLayerFactory } from '../../../src/pdf/PdfTextLayer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PDF 页面覆盖层', () => {
  it('按百分比渲染无指针事件的当前区块高亮', () => {
    const html = renderToStaticMarkup(
      <PdfBlockHighlightLayer polygon={[100, 200, 700, 800]} />,
    );
    expect(html).toContain('class="pdf-block-highlight-layer"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('left:10%');
    expect(html).toContain('top:20%');
    expect(html).toContain('width:60%');
    expect(html).toContain('height:60%');
  });

  it('坐标非法时不创建覆盖层', () => {
    expect(renderToStaticMarkup(<PdfBlockHighlightLayer polygon={[1, 1, 1, 2]} />)).toBe('');
  });

  it('创建真实 TextLayer，并在 viewport 更新和卸载时取消旧实例', async () => {
    const calls: Array<{ options: unknown; cancelCount: number }> = [];
    const factory: TextLayerFactory = (options) => {
      const call = { options, cancelCount: 0 };
      calls.push(call);
      return {
        render: async () => undefined,
        cancel: () => { call.cancelCount += 1; },
      };
    };
    const page = { streamTextContent: () => new ReadableStream() };
    const viewport = { width: 600, height: 800 };
    const container = document.createElement('div');
    const root = createRoot(container);
    const activeChanges: boolean[] = [];

    await act(async () => {
      root.render(<PdfTextLayer page={page as never} viewport={viewport as never} fitScale={0.5} createLayer={factory} onActiveChange={(_renderId, active) => activeChanges.push(active)} />);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ viewport });
    expect(container.querySelector<HTMLElement>('.pdf-text-layer.textLayer')?.style.transform).toBe('scale(0.5)');

    await act(async () => {
      root.render(<PdfTextLayer page={page as never} viewport={{ ...viewport, width: 700 } as never} createLayer={factory} onActiveChange={(_renderId, active) => activeChanges.push(active)} />);
    });
    expect(calls[0].cancelCount).toBe(1);
    expect(calls).toHaveLength(2);

    await act(async () => root.unmount());
    expect(calls[1].cancelCount).toBe(1);
    expect(activeChanges).toEqual([true, false, true, false]);
  });

  it('取消 TextLayer 后只在异步 render 真正结束时报告 inactive', async () => {
    let settle!: () => void;
    const renderPromise = new Promise<void>((resolve) => { settle = resolve; });
    const changes: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);
    const page = { streamTextContent: () => new ReadableStream() };
    const factory: TextLayerFactory = () => ({ render: () => renderPromise, cancel: vi.fn() });

    await act(async () => root.render(<PdfTextLayer
      page={page as never}
      viewport={{ width: 600, height: 800 } as never}
      createLayer={factory}
      onActiveChange={(_renderId, active) => changes.push(active)}
    />));
    expect(changes).toEqual([true]);
    await act(async () => root.unmount());
    expect(changes).toEqual([true]);
    settle();
    await renderPromise;
    await Promise.resolve();
    expect(changes).toEqual([true, false]);
  });
});
