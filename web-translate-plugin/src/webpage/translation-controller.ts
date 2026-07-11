import type { AppliedTranslation, TextBlock } from './contracts';

export class TranslationController {
  private readonly blocksById: Map<string, TextBlock>;
  private readonly appliedIds = new Set<string>();

  constructor(blocks: readonly TextBlock[]) {
    this.blocksById = new Map(blocks.map((block) => [block.id, block]));
  }

  add(blocks: readonly TextBlock[]): void {
    for (const block of blocks) {
      if (!this.blocksById.has(block.id)) this.blocksById.set(block.id, block);
    }
  }

  apply(results: readonly AppliedTranslation[]): void {
    for (const result of results) {
      const block = this.blocksById.get(result.id);
      if (!block || !block.node.isConnected) {
        continue;
      }
      block.node.data = result.text;
      block.node.parentElement?.setAttribute(
        'data-web-translate-original',
        block.original,
      );
      block.node.parentElement?.setAttribute('data-web-translate-id', block.id);
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
}
