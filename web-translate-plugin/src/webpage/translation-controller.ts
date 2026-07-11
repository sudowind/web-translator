import type { AppliedTranslation, TextBlock } from './contracts';

export class TranslationController {
  private readonly blocksById: Map<string, TextBlock>;
  private readonly appliedIds = new Set<string>();

  constructor(blocks: readonly TextBlock[]) {
    this.blocksById = new Map(blocks.map((block) => [block.id, block]));
  }

  apply(results: readonly AppliedTranslation[]): void {
    for (const result of results) {
      const block = this.blocksById.get(result.id);
      if (!block || !block.node.isConnected) {
        continue;
      }
      block.node.data = result.text;
      this.appliedIds.add(result.id);
    }
  }

  revealOriginal(id: string): void {
    const block = this.blocksById.get(id);
    if (!block || !block.node.isConnected) {
      return;
    }
    block.node.data = block.original;
    this.appliedIds.delete(id);
  }

  restore(): void {
    for (const id of this.appliedIds) {
      const block = this.blocksById.get(id);
      if (block?.node.isConnected) {
        block.node.data = block.original;
      }
    }
    this.appliedIds.clear();
  }
}
