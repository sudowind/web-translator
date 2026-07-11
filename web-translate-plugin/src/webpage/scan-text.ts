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

export function scanTextNodes(root: Node): TextBlock[] {
  const document =
    root.nodeType === Node.DOCUMENT_NODE
      ? (root as Document)
      : root.ownerDocument;
  if (!document) {
    return [];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks: TextBlock[] = [];
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    if (/[A-Za-z]/.test(node.data) && isUsable(node)) {
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

function isUsable(node: Text): boolean {
  let element = node.parentElement;
  const view = node.ownerDocument.defaultView;
  let editableStateResolved = false;

  while (element) {
    const contentEditable = element.getAttribute('contenteditable');
    if (contentEditable !== null && !editableStateResolved) {
      editableStateResolved = true;
      if (contentEditable.toLowerCase() !== 'false') {
        return false;
      }
    }
    if (
      SKIPPED_ELEMENTS.has(element.tagName) ||
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

    element = element.parentElement;
  }

  return true;
}
