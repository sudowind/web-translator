import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fitPageHeight, PagePair } from '../../../src/pdf/PairedPageViewer';

describe('PDF 与译文逐页配对', () => {
  it('按可用栏宽预计算页面高度，避免延迟渲染时改变文档流', () => {
    expect(fitPageHeight(600, 800, 300)).toBe(400);
    expect(fitPageHeight(600, 800, 900)).toBe(800);
  });

  it('在同一语义页组中以相同高度呈现原文和译文', () => {
    const html = renderToStaticMarkup(
      <PagePair
        number={3}
        height={720}
        pdf={<div>pdf</div>}
        translation={<div>translation</div>}
      />,
    );
    expect(html).toContain('class="page-pair"');
    expect(html).toContain('data-page-pair="3"');
    expect(html.match(/height:720px/g)).toHaveLength(3);
    expect(html).toContain('class="page-pair-pdf"');
    expect(html).toContain('class="page-pair-translation"');
  });
});
