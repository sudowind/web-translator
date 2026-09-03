import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_SCHEMA_VERSION, type DocumentModel } from '../../../src/document/model';
import { visibleTranslationPageWindow } from '../../../src/pdf/PairedPageViewer';
import { visiblePageWindow } from '../../../src/pdf/PdfViewer';
import { TranslationPage } from '../../../src/pdf/TranslationPane';

const model: DocumentModel = {
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  id: 'h', sourceUrl: 'https://x.test/p.pdf', hash: 'h', title: 'Paper', pageCount: 2,
  pages: [
    { id: 'p1', index: 0, blocks: [
      { id: 'h1', pageId: 'p1', order: 0, kind: 'heading', headingLevel: 1, text: 'Heading 1', polygon: [100, 100, 900, 180] },
      { id: 'h2', pageId: 'p1', order: 1, kind: 'heading', headingLevel: 2, text: 'Heading 2' },
      { id: 'h3', pageId: 'p1', order: 2, kind: 'heading', headingLevel: 3, text: 'Heading 3' },
      { id: 'h8', pageId: 'p1', order: 3, kind: 'heading', headingLevel: 8, text: 'Heading 8' },
      { id: 'b1', pageId: 'p1', order: 4, kind: 'paragraph', text: '<script>alert(1)</script>', polygon: [100, 200, 900, 500] },
      { id: 'l1', pageId: 'p1', order: 5, kind: 'list', text: '- One\n- Two' },
      { id: 't1', pageId: 'p1', order: 6, kind: 'table', text: 'table OCR', caption: 'Table title', html: '<table><tr><td>secret cell</td></tr></table>' },
      { id: 'f1', pageId: 'p1', order: 7, kind: 'figure', text: 'image OCR', caption: 'Figure title', resourceUrl: 'images/secret.png' },
      { id: 't2', pageId: 'p1', order: 8, kind: 'table', text: '', html: '<table></table>' },
    ] },
    { id: 'p2', index: 1, blocks: [{ id: 'b2', pageId: 'p2', order: 0, kind: 'formula', text: '$$ x^2 \\tag{1} $$', latex: 'x^2 \\tag{1}' }] },
  ],
};

describe('PDF 逐页配对组件契约', () => {
  it('只把当前页与邻近页放入立即渲染窗口', () => {
    expect(visiblePageWindow(5, 10)).toEqual(new Set([3, 4, 5, 6, 7]));
    expect(visiblePageWindow(1, 10)).toEqual(new Set([1, 2, 3]));
    expect(visibleTranslationPageWindow(10, 76)).toEqual(new Set([8, 9, 10, 11, 12]));
  });

  it('离屏译文只保留轻量页面壳且未请求页面不遍历区块', () => {
    const deferred = renderToStaticMarkup(
      <TranslationPage
        page={model.pages[0]}
        number={1}
        height={640}
        translations={new Map()}
        status="done"
        renderBody={false}
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(deferred).toContain('data-translation-body="deferred"');
    expect(deferred).toContain('译文已缓存');
    expect(deferred).not.toContain('data-block-id');

    const unrequested = renderToStaticMarkup(
      <TranslationPage
        page={model.pages[0]}
        number={1}
        height={640}
        translations={new Map()}
        status="unrequested"
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(unrequested).toContain('滚动到本页后自动翻译');
    expect(unrequested).toContain('翻译本页');
    expect(unrequested).not.toContain('data-block-id');
  });

  it('单页译文固定为配对高度且不再创建整列滚动容器', () => {
    const html = renderToStaticMarkup(
      <TranslationPage
        page={model.pages[0]}
        number={1}
        height={640}
        translations={new Map([
          ['h1', { id: 'h1', text: '标题' }],
          ['h2', { id: 'h2', text: '二级标题' }],
          ['h3', { id: 'h3', text: '三级标题' }],
          ['h8', { id: 'h8', text: '八级标题' }],
          ['b1', { id: 'b1', text: '<img src=x onerror=alert(1)>' }],
          ['l1', { id: 'l1', text: '- 第一\n- 第二' }],
          ['t1', { id: 't1', text: '表格标题' }],
        ])}
        status="done"
        pinnedBlockId="b1"
        onBlockPreview={() => undefined}
        onBlockPin={() => undefined}
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(html).toContain('data-translation-page="1"');
    expect(html).toContain('data-status="done"');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('data-block-id="h1"');
    expect(html).toContain('data-block-kind="heading"');
    expect(html).toContain('<h3>');
    expect(html).toContain('<h4>');
    expect(html).toContain('<h5>');
    expect(html).toContain('<h6>');
    expect(html).toContain('<ul>');
    expect(html).toContain('class="translation-media-placeholder"');
    expect(html).toContain('data-media-kind="table"');
    expect(html).toContain('data-media-kind="figure"');
    expect(html).toContain('表格标题');
    expect(html).toContain('标题译文缺失');
    expect(html).toContain('无标题');
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('翻译中');
    expect(html).toContain('data-pinned="true"');
    expect(html).toContain('class="translation-page"');
    expect(html).toContain('style="height:640px"');
    expect(html).toContain('class="translation-page-body"');
    expect(html).not.toContain('class="translation-pages"');
  });

  it.each([
    ['translating' as const, '标题翻译中…'],
    ['failed' as const, '标题翻译失败'],
  ])('媒体标题在 %s 状态下显示明确文案', (status, expected) => {
    const html = renderToStaticMarkup(
      <TranslationPage
        page={{
          id: 'media-page',
          index: 0,
          blocks: [{
            id: 'media-table', pageId: 'media-page', order: 0, kind: 'table',
            text: 'table OCR', caption: 'Table title', html: '<table><tr><td>secret</td></tr></table>',
          }],
        }}
        number={1}
        height={480}
        translations={new Map()}
        status={status}
        onRetry={() => undefined}
        onCopyFailure={() => undefined}
      />,
    );
    expect(html).toContain(expected);
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('secret');
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
    expect(html).toContain('katex-display');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('失败：请求超时');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('复制诊断信息');
    expect(html).toContain('第 2/3 次尝试');
  });
});
