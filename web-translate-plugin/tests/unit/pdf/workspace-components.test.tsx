import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import { visiblePageWindow } from '../../../src/pdf/PdfViewer';
import { TranslationPage } from '../../../src/pdf/TranslationPane';

const model: DocumentModel = {
  id: 'h', sourceUrl: 'https://x.test/p.pdf', hash: 'h', title: 'Paper', pageCount: 2,
  pages: [
    { id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'paragraph', text: '<script>alert(1)</script>' }] },
    { id: 'p2', index: 1, blocks: [{ id: 'b2', pageId: 'p2', order: 0, kind: 'formula', text: 'x^2', latex: 'x^2' }] },
  ],
};

describe('PDF 逐页配对组件契约', () => {
  it('只把当前页与邻近页放入立即渲染窗口', () => {
    expect(visiblePageWindow(5, 10)).toEqual(new Set([3, 4, 5, 6, 7]));
    expect(visiblePageWindow(1, 10)).toEqual(new Set([1, 2, 3]));
  });

  it('单页译文固定为配对高度且不再创建整列滚动容器', () => {
    const html = renderToStaticMarkup(
      <TranslationPage
        page={model.pages[0]}
        number={1}
        height={640}
        translations={new Map([['b1', { id: 'b1', text: '<img src=x onerror=alert(1)>' }]])}
        status="done"
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(html).toContain('data-translation-page="1"');
    expect(html).toContain('data-status="done"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('class="translation-page"');
    expect(html).toContain('style="height:640px"');
    expect(html).toContain('class="translation-page-body"');
    expect(html).not.toContain('class="translation-pages"');
  });

  it('公式、失败详情和重试次数仍在单页中完整呈现', () => {
    const html = renderToStaticMarkup(
      <TranslationPage
        page={model.pages[1]}
        number={2}
        height={820}
        translations={new Map()}
        status="retrying"
        attempt={2}
        failure={{
          code: 'TRANSLATION_TIMEOUT', category: 'timeout', summary: '请求超时', retryable: true,
          attempts: 1, durationMs: 30_001, provider: 'openai-compatible', model: 'qwen-plus', occurredAt: 100,
        }}
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(html).toContain('katex');
    expect(html).toContain('失败：请求超时');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('复制诊断信息');
    expect(html).toContain('第 2/3 次尝试');
  });
});
