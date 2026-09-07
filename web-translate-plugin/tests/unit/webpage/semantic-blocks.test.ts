// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderInlineTranslation, scanSemanticBlocks } from '../../../src/webpage/semantic-blocks';

beforeEach(() => { document.body.innerHTML = ''; });
describe('语义块和安全行内格式', () => {
  it('标题、段落、列表、引用按完整句段扫描，保留中文', () => {
    document.body.innerHTML = '<h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em> <a href="/help">link</a>.</p><ul><li>Parent<ul><li>Child</li></ul>Tail</li></ul><blockquote><p>Quoted</p></blockquote><div>中文内容</div>';
    const blocks = scanSemanticBlocks(document.body);
    expect(blocks.map(b => b.text)).toEqual(['Title', 'Hello ⟦wt:0⟧bold⟦/wt:0⟧ and ⟦wt:1⟧italic⟦/wt:1⟧ ⟦wt:2⟧link⟦/wt:2⟧.', 'Parent', 'Child', 'Tail', 'Quoted', '中文内容']);
  });
  it('通用容器内的直接文字与嵌套段落均不丢失或重复', () => {
    document.body.innerHTML = '<div>Before <span>inline</span><section><p>Nested</p></section>After</div>';
    expect(scanSemanticBlocks(document.body).map(b => b.text)).toEqual(['Before ⟦wt:0⟧inline⟦/wt:0⟧', 'Nested', 'After']);
  });
  it('跳过隐藏区、输入区、代码块、控件与插件节点', () => {
    document.body.innerHTML = '<div hidden><p>Hidden</p></div><div style="display:none">Invisible</div><div contenteditable>Editable</div><pre>Code</pre><button>Submit</button><svg><text>SVG</text></svg><span data-web-translate-ui>Own</span><p>Visible</p>';
    expect(scanSemanticBlocks(document.body).map(b => b.text)).toEqual(['Visible']);
  });
  it('行内代码和换行通过受保护标记保留，不提交代码内容', () => {
    document.body.innerHTML = '<p>Run <code>secretCode()</code><br>now</p>';
    const block = scanSemanticBlocks(document.body)[0];
    expect(block.text).toBe('Run ⟦wt:0/⟧⟦wt:1/⟧now');
    const fragment = renderInlineTranslation(block, '运行 ⟦wt:0/⟧⟦wt:1/⟧现在');
    expect(fragment.querySelector('code')?.textContent).toBe('secretCode()');
    expect(fragment.querySelectorAll('br')).toHaveLength(1);
  });
  it('安全重建嵌套样式和链接，不复制 id、class、事件或 HTML', () => {
    document.body.innerHTML = '<p style="font-size:18px;color:rgb(1,2,3)"><a id="original" class="site" href="https://example.org/help" target="_blank" onclick="bad()"><strong>Read</strong></a></p>';
    const block = scanSemanticBlocks(document.body)[0];
    const fragment = renderInlineTranslation(block, '⟦wt:0⟧⟦wt:1⟧阅读⟦/wt:1⟧⟦/wt:0⟧<img src=x onerror=bad()>');
    const a = fragment.querySelector('a')!;
    expect(a.href).toBe('https://example.org/help');
    expect(a.rel).toBe('noopener noreferrer');
    expect(a.hasAttribute('id')).toBe(false);
    expect(a.hasAttribute('onclick')).toBe(false);
    expect(a.hasAttribute('class')).toBe(false);
    expect(fragment.querySelector('strong')?.textContent).toBe('阅读');
    expect(fragment.querySelector('img')).toBeNull();
  });
  it('危险链接不复制到译文', () => {
    document.body.innerHTML = '<p>Read <a href="javascript:alert(1)">here</a></p>';
    const block = scanSemanticBlocks(document.body)[0];
    expect(renderInlineTranslation(block, block.text).querySelector('a')?.hasAttribute('href')).toBe(false);
  });
  it.each(['Missing', '⟦wt:0⟧x', '⟦wt:0⟧x⟦/wt:0⟧⟦wt:0⟧again⟦/wt:0⟧', '⟦wt:99⟧x⟦/wt:99⟧', '⟦wt:0/⟧'])('拒绝缺失、重复或损坏的标记：%s', output => {
    document.body.innerHTML = '<p><strong>Bold</strong></p>';
    expect(() => renderInlineTranslation(scanSemanticBlocks(document.body)[0], output)).toThrow('WEBPAGE_INLINE_INVALID');
  });
  it('禁止将子标记移出原父标记，但允许同级短语调序', () => {
    document.body.innerHTML = '<p><strong>A<em>B</em></strong><i>C</i></p>';
    const block = scanSemanticBlocks(document.body)[0];
    expect(() => renderInlineTranslation(block, '⟦wt:0⟧甲⟦/wt:0⟧⟦wt:1⟧乙⟦/wt:1⟧⟦wt:2⟧丙⟦/wt:2⟧')).toThrow();
    expect(() => renderInlineTranslation(block, '⟦wt:2⟧丙⟦/wt:2⟧⟦wt:0⟧甲⟦wt:1⟧乙⟦/wt:1⟧⟦/wt:0⟧')).not.toThrow();
  });
});
