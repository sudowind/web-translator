// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { PdfBlockHighlightLayer } from '../../../src/pdf/PdfBlockHighlightLayer';
import { PdfTextLayer, type TextLayerFactory } from '../../../src/pdf/PdfTextLayer';

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

    await act(async () => {
      root.render(<PdfTextLayer page={page as never} viewport={viewport as never} createLayer={factory} />);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ viewport });
    expect(container.querySelector('.pdf-text-layer.textLayer')).not.toBeNull();

    await act(async () => {
      root.render(<PdfTextLayer page={page as never} viewport={{ ...viewport, width: 700 } as never} createLayer={factory} />);
    });
    expect(calls[0].cancelCount).toBe(1);
    expect(calls).toHaveLength(2);

    await act(async () => root.unmount());
    expect(calls[1].cancelCount).toBe(1);
  });
});
