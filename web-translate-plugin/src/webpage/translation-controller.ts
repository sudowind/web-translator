import type { AppliedTranslation, TextBlock } from './contracts';

export class TranslationController {
  private readonly blocksById = new Map<string, TextBlock>();
  private readonly blocksByNode = new WeakMap<Text, TextBlock>();
  private readonly appliedIds = new Set<string>();
  private readonly appliedParentById = new Map<string, Element>();
  private readonly touchedParents = new Set<Element>();

  constructor(blocks: readonly TextBlock[]) {
    this.add(blocks);
  }

  add(blocks: readonly TextBlock[]): TextBlock[] {
    const added: TextBlock[] = [];
    for (const block of blocks) {
      if (this.blocksById.has(block.id)) {
        this.syncAppliedParent(block.id);
        continue;
      }
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
      const previousParent = this.appliedParentById.get(result.id);
      block.node.data = result.text;
      const parent = block.node.parentElement;
      if (parent) {
        this.appliedParentById.set(result.id, parent);
        this.touchedParents.add(parent);
      }
      this.appliedIds.add(result.id);
      if (previousParent && previousParent !== parent) {
        this.refreshParent(previousParent);
      }
      if (parent) this.refreshParent(parent);
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
        if (block.node.parentElement) {
          this.touchedParents.add(block.node.parentElement);
        }
        this.appliedIds.delete(id);
        this.appliedParentById.delete(id);
      }
    }
    for (const parent of this.touchedParents) this.clearParent(parent);
    if (this.appliedIds.size === 0) this.touchedParents.clear();
  }

  private syncAppliedParent(id: string): void {
    if (!this.appliedIds.has(id)) return;
    const block = this.blocksById.get(id);
    const previousParent = this.appliedParentById.get(id);
    const currentParent = block?.node.parentElement ?? undefined;
    if (previousParent === currentParent) return;

    if (previousParent) this.touchedParents.add(previousParent);
    if (currentParent) {
      this.appliedParentById.set(id, currentParent);
      this.touchedParents.add(currentParent);
    } else {
      this.appliedParentById.delete(id);
    }
    if (previousParent) this.refreshParent(previousParent);
    if (currentParent) this.refreshParent(currentParent);
  }

  private refreshParent(parent: Element): void {
    const appliedIds = [...this.appliedParentById]
      .filter(([id, value]) => value === parent && this.appliedIds.has(id))
      .map(([id]) => id);
    if (appliedIds.length === 0) {
      this.clearParent(parent);
      return;
    }
    parent.setAttribute(
      'data-web-translate-original',
      this.readCompleteOriginal(parent),
    );
    parent.setAttribute('data-web-translate-id', appliedIds[0]);
  }

  private clearParent(parent: Element): void {
    parent.removeAttribute('data-web-translate-original');
    parent.removeAttribute('data-web-translate-id');
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
