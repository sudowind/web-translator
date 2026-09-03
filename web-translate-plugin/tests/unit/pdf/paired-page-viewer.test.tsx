import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fitPageHeight, mapsNearlyEqual, PagePair } from '../../../src/pdf/PairedPageViewer';
import { computeReadingLayout } from '../../../src/pdf/page-layout';

describe('PDF 与译文逐页配对', () => {
  it('按可用栏宽预计算页面高度，避免延迟渲染时改变文档流', () => {
    expect(fitPageHeight(600, 800, 300)).toBe(400);
    expect(fitPageHeight(600, 800, 900)).toBe(800);
  });

  it('仅在页面高度发生可见变化时发布新映射', () => {
    expect(mapsNearlyEqual(new Map([[1, 800]]), new Map([[1, 800.4]]))).toBe(true);
    expect(mapsNearlyEqual(new Map([[1, 800]]), new Map([[1, 801]]))).toBe(false);
    expect(mapsNearlyEqual(new Map([[1, 800]]), new Map([[2, 800]]))).toBe(false);
  });

  it('在同一语义页组中以相同高度呈现原文和译文', () => {
    const layout = computeReadingLayout({ containerWidth: 1400, pageWidth: 612, requestedScale: 1.1 });
    const html = renderToStaticMarkup(
      <PagePair
        number={3}
        height={720}
        layout={layout}
        pdf={<div>pdf</div>}
        translation={<div>translation</div>}
      />,
    );
    expect(html).toContain('class="page-pair"');
    expect(html).toContain('data-page-pair="3"');
    expect(html).toContain('data-layout="paired"');
    expect(html).toContain('--pdf-page-width:673.2px');
    expect(html).toContain('--translation-page-width:520px');
    expect(html.match(/height:720px/g)).toHaveLength(3);
    expect(html).toContain('class="page-pair-pdf"');
    expect(html).toContain('class="page-pair-translation"');
  });

  it('上下布局不固定页对外层高度', () => {
    const layout = computeReadingLayout({ containerWidth: 800, pageWidth: 612, requestedScale: 1.8 });
    const html = renderToStaticMarkup(
      <PagePair
        number={1}
        height={1035.3}
        layout={layout}
        pdf={<div>pdf</div>}
        translation={<div>translation</div>}
      />,
    );

    expect(html).toContain('data-layout="stacked"');
    expect(html).toContain('--page-pair-width:800px');
    expect(html.match(/height:1035.3px/g)).toHaveLength(2);
  });
});
