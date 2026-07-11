import type { TextBlock } from './contracts';

const SKIPPED_ELEMENTS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
]);
interface TextMetadata {
  id: string;
  original: string;
}

const metadataByNode = new WeakMap<Text, TextMetadata>();
let nextId = 0;

export function scanTextNodes(root: Document | Element): TextBlock[] {
  const document = root instanceof Document ? root : root.ownerDocument;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks: TextBlock[] = [];
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    if (/[A-Za-z]/.test(node.data) && isUsable(node, root)) {
      let metadata = metadataByNode.get(node);
      if (!metadata) {
        metadata = {
          id: `web-translate-${++nextId}`,
          original: node.data,
        };
        metadataByNode.set(node, metadata);
      }
      blocks.push({ ...metadata, node });
    }
    current = walker.nextNode();
  }

  return blocks;
}

function isUsable(node: Text, root: Document | Element): boolean {
  let element = node.parentElement;
  const view = node.ownerDocument.defaultView;

  while (element) {
    if (
      SKIPPED_ELEMENTS.has(element.tagName) ||
      element.hasAttribute('contenteditable') ||
      element.hasAttribute('data-web-translate-ui') ||
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.hasAttribute('inert') ||
      element.hasAttribute('disabled')
    ) {
      return false;
    }

    const style = view?.getComputedStyle(element);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    ) {
      return false;
    }

    if (element === root) {
      break;
    }
    element = element.parentElement;
  }

  return true;
}
