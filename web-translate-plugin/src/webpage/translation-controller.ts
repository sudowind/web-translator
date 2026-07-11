import type { AppliedTranslation, TextBlock } from './contracts';

export class TranslationController {
  private readonly blocksById = new Map<string, TextBlock>();
  private readonly blocksByNode = new WeakMap<Text, TextBlock>();
  private readonly appliedIds = new Set<string>();

  constructor(blocks: readonly TextBlock[]) {
    this.add(blocks);
  }

  add(blocks: readonly TextBlock[]): TextBlock[] {
    const added: TextBlock[] = [];
    for (const block of blocks) {
      if (this.blocksById.has(block.id)) continue;
      this.blocksById.set(block.id, block);
      this.blocksByNode.set(block.node, block);
      added.push(block);
    }
    return added;
  }

  apply(results: readonly AppliedTranslation[]): void {
    for (const result of results) {
      const block = this.blocksById.get(result.id);
      if (!block || !block.node.isConnected) {
        continue;
      }
      block.node.data = result.text;
      const parent = block.node.parentElement;
      if (parent) {
        parent.setAttribute(
          'data-web-translate-original',
          this.readCompleteOriginal(parent),
        );
        if (!parent.hasAttribute('data-web-translate-id')) {
          parent.setAttribute('data-web-translate-id', block.id);
        }
      }
      this.appliedIds.add(result.id);
    }
  }

  revealOriginal(id: string): string | null {
    const block = this.blocksById.get(id);
    return block?.original ?? null;
  }

  restore(): void {
    for (const id of this.appliedIds) {
      const block = this.blocksById.get(id);
      if (block?.node.isConnected) {
        block.node.data = block.original;
        block.node.parentElement?.removeAttribute('data-web-translate-original');
        block.node.parentElement?.removeAttribute('data-web-translate-id');
        this.appliedIds.delete(id);
      }
    }
  }

  private readCompleteOriginal(parent: Element): string {
    const walker = parent.ownerDocument.createTreeWalker(
      parent,
      NodeFilter.SHOW_TEXT,
    );
    let original = '';
    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      original += this.blocksByNode.get(node)?.original ?? node.data;
      current = walker.nextNode();
    }
    return original;
  }
}
