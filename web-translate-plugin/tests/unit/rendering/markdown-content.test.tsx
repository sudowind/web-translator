import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownContent, normalizePageReferences, safeMarkdownUrl } from '../../../src/rendering/MarkdownContent';

describe('统一 Markdown 与数学公式渲染', () => {
  it('渲染标题、列表、代码、GFM 表格和数学公式', () => {
    const content = [
      '# 结论',
      '- 第一项',
      '',
      '```ts\nconst answer = 42;\n```',
      '',
      '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |',
      '',
      '行内 $x^2$，行间：',
      '$$E=mc^2$$',
    ].join('\n');
    const html = renderToStaticMarkup(<MarkdownContent content={content} />);

    expect(html).toContain('<h1>结论</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<table>');
    expect(html).toContain('katex');
  });

  it('不执行原始 HTML 或危险链接', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'<img src=x onerror=alert(1)> [危险](javascript:alert(1))'} />,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(safeMarkdownUrl('https://example.test')).toBe('https://example.test');
    expect(safeMarkdownUrl('data:text/html,x')).toBe('');
  });

  it('只把合法范围内的页码引用变成内部链接', () => {
    expect(normalizePageReferences('证据 [p:2] [p:9]', 3)).toBe(
      '证据 [第 2 页](pdf-page:2) [p:9]',
    );
    const html = renderToStaticMarkup(
      <MarkdownContent content="证据 [p:2]" pageCount={3} onNavigatePage={() => undefined} />,
    );
    expect(html).toContain('<button type="button" class="page-reference"');
    expect(html).toContain('第 2 页');
  });

  it('流式阶段遇到未闭合 Markdown 和公式时仍保留可读文本', () => {
    expect(() => renderToStaticMarkup(
      <MarkdownContent content={'回答中 ```ts\nconst x = 1\n未完成公式 $x^'} />,
    )).not.toThrow();
  });
});
