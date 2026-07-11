// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { scanTextNodes } from '../../../src/webpage/scan-text';

describe('文本节点扫描', () => {
  it('仅返回英文文本节点并保留完整原文、节点引用与稳定唯一 ID', () => {
    document.body.innerHTML = `
      <main>
        <p id="first">  Hello world  </p>
        <p>纯中文</p>
        <div><span id="second">Second block.</span></div>
      </main>
    `;
    const firstNode = document.querySelector('#first')!.firstChild as Text;
    const secondNode = document.querySelector('#second')!.firstChild as Text;

    const firstScan = scanTextNodes(document.body);
    const secondScan = scanTextNodes(document.body);

    expect(firstScan).toHaveLength(2);
    expect(firstScan.map(({ original }) => original)).toEqual([
      '  Hello world  ',
      'Second block.',
    ]);
    expect(firstScan.map(({ node }) => node)).toEqual([firstNode, secondNode]);
    expect(new Set(firstScan.map(({ id }) => id)).size).toBe(2);
    expect(secondScan.map(({ id }) => id)).toEqual(
      firstScan.map(({ id }) => id),
    );
  });

  it('跳过禁止元素、可编辑区、插件 UI 与隐藏或不可用祖先', () => {
    document.body.innerHTML = `
      <main>
        <script>Script English</script>
        <style>.English { color: red }</style>
        <noscript>Noscript English</noscript>
        <textarea>Textarea English</textarea>
        <input value="Input English">
        <select><option>Option English</option></select>
        <code>Code English</code><pre>Pre English</pre>
        <kbd>Key English</kbd><samp>Sample English</samp>
        <div contenteditable="true">Editable English</div>
        <div data-web-translate-ui>Plugin English</div>
        <div hidden>Hidden English</div>
        <div aria-hidden="true">Aria hidden English</div>
        <div style="display:none">Display hidden English</div>
        <div inert>Inert English</div>
        <p>Visible English</p>
      </main>
    `;

    expect(scanTextNodes(document.body).map(({ original }) => original)).toEqual([
      'Visible English',
    ]);
  });

  it('返回文本节点而不替换或重建父元素', () => {
    document.body.innerHTML = '<p id="parent"><strong>Hello</strong> world</p>';
    const parent = document.querySelector('#parent')!;
    const children = [...parent.childNodes];

    scanTextNodes(parent);

    expect(document.querySelector('#parent')).toBe(parent);
    expect([...parent.childNodes]).toEqual(children);
  });

  it('节点文本变化后重复扫描仍保留首次发现的完整原文', () => {
    document.body.innerHTML = '<p>  Original English  </p>';
    const first = scanTextNodes(document.body)[0];
    first.node.data = 'Translated English';

    const rescanned = scanTextNodes(document.body)[0];

    expect(rescanned.id).toBe(first.id);
    expect(rescanned.original).toBe('  Original English  ');
  });

  it.each([
    ['contenteditable 祖先', '<div contenteditable="true"><section>Outer English</section></div>'],
    ['隐藏祖先', '<div hidden><section>Outer English</section></div>'],
    ['插件 UI 祖先', '<div data-web-translate-ui><section>Outer English</section></div>'],
  ])('扫描增量 root 时仍跳过 root 外的%s', (_label, html) => {
    document.body.innerHTML = html;
    const root = document.querySelector('section')!;

    expect(scanTextNodes(root)).toEqual([]);
  });

  it('不把 contenteditable=false 当作可编辑祖先', () => {
    document.body.innerHTML =
      '<div contenteditable="false"><section>Allowed English</section></div>';

    expect(
      scanTextNodes(document.querySelector('section')!).map(
        ({ original }) => original,
      ),
    ).toEqual(['Allowed English']);
  });

  it('支持扫描 DocumentFragment', () => {
    const fragment = document.createDocumentFragment();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Fragment English';
    fragment.append(paragraph);

    expect(scanTextNodes(fragment).map(({ original }) => original)).toEqual([
      'Fragment English',
    ]);
  });

  it('扫描作为增量 root 的直接 Text 节点本身', () => {
    const text = document.createTextNode('Direct dynamic English');
    document.body.append(text);

    expect(scanTextNodes(text).map(({ node, original }) => ({ node, original }))).toEqual([
      { node: text, original: 'Direct dynamic English' },
    ]);
  });
});
