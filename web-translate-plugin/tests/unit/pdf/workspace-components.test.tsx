import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import { visiblePageWindow } from '../../../src/pdf/PdfViewer';
import { TranslationPane } from '../../../src/pdf/TranslationPane';

const model: DocumentModel = {
  id: 'h', sourceUrl: 'https://x.test/p.pdf', hash: 'h', title: 'Paper', pageCount: 2,
  pages: [
    { id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: '<script>alert(1)</script>' }] },
    { id: 'p2', index: 1, blocks: [{ id: 'b2', pageId: 'p2', order: 0, kind: 'formula', text: 'x^2', latex: 'x^2' }] },
  ],
};

describe('PDF 双栏组件契约', () => {
  it('只把当前页与邻近页放入立即渲染窗口', () => {
    expect(visiblePageWindow(5, 10)).toEqual(new Set([4, 5, 6]));
    expect(visiblePageWindow(1, 10)).toEqual(new Set([1, 2]));
  });

  it('译文逐页输出状态锚点且不直接注入不可信 HTML', () => {
    const html = renderToStaticMarkup(
      <TranslationPane
        model={model}
        translations={new Map([['b1', { id: 'b1', text: '<img src=x onerror=alert(1)>' }]])}
        pageStatus={new Map([[1, 'done'], [2, 'pending']])}
        onPageVisible={() => undefined}
      />,
    );
    expect(html).toContain('data-translation-page="1"');
    expect(html).toContain('data-status="done"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('katex');
  });
});
