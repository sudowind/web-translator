export const OWNED_SELECTOR = '[data-web-translate-ui]';
const EXCLUDED = 'script,style,noscript,textarea,input,select,button,pre,kbd,samp,svg,canvas,iframe,object,embed,video,audio';
const BLOCK_TAGS = new Set('ADDRESS ARTICLE ASIDE BLOCKQUOTE BODY DD DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P SECTION TABLE TBODY TD TH THEAD TR UL'.split(' '));
const INLINE_TAGS = new Set('A B STRONG I EM SPAN U S DEL MARK SMALL SUB SUP Q CITE ABBR CODE BR'.split(' '));
const STYLE_PROPERTIES = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'letter-spacing', 'text-decoration-line', 'text-decoration-color', 'text-transform', 'white-space', 'direction'] as const;

export interface InlineSlot {
  tag: string;
  style: string;
  href?: string;
  target?: string;
  fixedText?: string;
  parent: number | null;
}

export interface SemanticBlock {
  key: Node;
  container: HTMLElement;
  nodes: Node[];
  text: string;
  slots: InlineSlot[];
  style: string;
  signature: string;
}

export function scanSemanticBlocks(root: HTMLElement, articleOnly = false): SemanticBlock[] {
  const blocks: SemanticBlock[] = [];
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (element: Element) => {
    let value = styleCache.get(element);
    if (!value) {
      value = element.ownerDocument.defaultView!.getComputedStyle(element);
      styleCache.set(element, value);
    }
    return value;
  };
  const excluded = (element: Element): boolean => {
    if (articleOnly && element.matches('nav,aside,footer,[role="navigation"],[role="complementary"],[role="contentinfo"],[role="banner"],[data-ad],[data-ad-slot],header:not(main header,article header,[role="main"] header)')) return true;
    if (element.matches(`${EXCLUDED},${OWNED_SELECTOR}`) || element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('inert')) return true;
    const editable = element.closest('[contenteditable]');
    if (editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false') return true;
    const css = style(element);
    return css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse';
  };
  const isBlock = (element: Element) => BLOCK_TAGS.has(element.tagName) ||
    /^(block|flow-root|flex|grid|table|list-item)/.test(style(element).display);
  const hasBlock = (element: Element): boolean => Array.from(element.children)
    .some((child) => !excluded(child) && (isBlock(child) || hasBlock(child)));
  const textStyle = (element: Element) => STYLE_PROPERTIES
    .map((property) => `${property}:${style(element).getPropertyValue(property)};`).join('');

  function collect(container: HTMLElement): void {
    if (excluded(container)) return;
    let run: Node[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const nodes = run;
      run = [];
      const slots: InlineSlot[] = [];
      let naturalText = '';
      function serialize(node: Node, parent: number | null): string {
        if (node.nodeType === Node.TEXT_NODE) {
          naturalText += node.textContent;
          return node.textContent ?? '';
        }
        if (!(node instanceof HTMLElement) || excluded(node)) return '';
        // Decorative wrappers with identical inherited presentation need no paid marker tokens.
        if (node.tagName === 'SPAN' && node.parentElement && textStyle(node) === textStyle(node.parentElement)) {
          return Array.from(node.childNodes).map(child => serialize(child, parent)).join('');
        }
        const tag = INLINE_TAGS.has(node.tagName) ? node.tagName.toLowerCase() : 'span';
        const slot: InlineSlot = { tag, style: textStyle(node), parent };
        if (tag === 'a') {
          const href = safeHref(node.getAttribute('href'), node.baseURI);
          if (href) {
            slot.href = href;
            slot.target = node.getAttribute('target') === '_blank' ? '_blank' : undefined;
          }
        }
        const id = slots.push(slot) - 1;
        if (tag === 'br' || tag === 'code') {
          slot.fixedText = tag === 'code' ? node.textContent ?? '' : '';
          return `⟦wt:${id}/⟧`;
        }
        return `⟦wt:${id}⟧${Array.from(node.childNodes).map((child) => serialize(child, id)).join('')}⟦/wt:${id}⟧`;
      }
      const text = nodes.map((node) => serialize(node, null)).join('');
      if (!/\p{L}/u.test(naturalText)) return;
      const css = textStyle(container);
      blocks.push({ key: nodes[0], container, nodes, text, slots, style: css,
        signature: JSON.stringify([text, slots.map(({ tag, parent, fixedText }) => [tag, parent, fixedText])]) });
    };
    for (const node of container.childNodes) {
      if (node instanceof Element && node.matches(OWNED_SELECTOR)) continue;
      if (node instanceof HTMLElement) {
        if (excluded(node)) { flush(); continue; }
        if (isBlock(node) || hasBlock(node)) { flush(); collect(node); continue; }
      }
      if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLElement) run.push(node);
      else flush();
    }
    flush();
  }
  const content = articleOnly ? Array.from(root.querySelectorAll<HTMLElement>('main,[role="main"]')) : [];
  if (articleOnly && !content.length) content.push(...root.querySelectorAll<HTMLElement>('article'));
  for (const target of content.length ? content.filter(node => !content.some(other => other !== node && other.contains(node))) : [root]) {
    let parent: HTMLElement | null = target;
    let skip = false;
    while (parent && root.contains(parent)) { if (excluded(parent)) { skip = true; break; } parent = parent.parentElement; }
    if (!skip) collect(target);
  }
  return blocks;
}

function safeHref(value: string | null, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

// Model output is text plus validated slot markers, never executable HTML.
export function renderInlineTranslation(block: SemanticBlock, text: string): DocumentFragment {
  const document = block.container.ownerDocument;
  const fragment = document.createDocumentFragment();
  const stack: Array<{ id: number | null; node: Node }> = [{ id: null, node: fragment }];
  const seen = new Set<number>();
  const pattern = /⟦(\/?)wt:(\d+)(\/?)⟧/g;
  let offset = 0;
  const appendText = (value: string) => {
    if (value.includes('⟦wt:') || value.includes('⟦/wt:')) throw new Error('WEBPAGE_INLINE_INVALID');
    stack.at(-1)!.node.appendChild(document.createTextNode(value));
  };
  for (const match of text.matchAll(pattern)) {
    appendText(text.slice(offset, match.index));
    offset = match.index! + match[0].length;
    const id = Number(match[2]);
    const slot = block.slots[id];
    if (!slot) throw new Error('WEBPAGE_INLINE_INVALID');
    if (match[1]) {
      if (match[3] || stack.at(-1)!.id !== id || stack.length === 1) throw new Error('WEBPAGE_INLINE_INVALID');
      stack.pop();
      continue;
    }
    if (seen.has(id) || slot.parent !== stack.at(-1)!.id || Boolean(match[3]) !== (slot.fixedText !== undefined)) {
      throw new Error('WEBPAGE_INLINE_INVALID');
    }
    seen.add(id);
    const element = document.createElement(slot.tag);
    element.style.cssText = slot.style;
    if (slot.href) {
      element.setAttribute('href', slot.href);
      if (slot.target) { element.setAttribute('target', slot.target); element.setAttribute('rel', 'noopener noreferrer'); }
    }
    stack.at(-1)!.node.appendChild(element);
    if (slot.fixedText !== undefined) element.textContent = slot.fixedText;
    else stack.push({ id, node: element });
  }
  appendText(text.slice(offset));
  if (stack.length !== 1 || seen.size !== block.slots.length || !text.trim()) throw new Error('WEBPAGE_INLINE_INVALID');
  return fragment;
}
