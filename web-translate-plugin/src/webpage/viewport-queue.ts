import type { TextBlock } from './contracts';

export type ViewportPredicate = (block: TextBlock) => boolean;

export class ViewportQueue {
  private pending: TextBlock[];

  constructor(
    blocks: readonly TextBlock[],
    private readonly isInViewport: ViewportPredicate = defaultIsInViewport,
  ) {
    this.pending = [...blocks];
  }

  get size(): number {
    return this.pending.length;
  }

  takeBatch(limit: number): TextBlock[] {
    if (limit <= 0 || this.pending.length === 0) {
      return [];
    }

    const visible: TextBlock[] = [];
    const outside: TextBlock[] = [];
    for (const block of this.pending) {
      (this.isInViewport(block) ? visible : outside).push(block);
    }
    const ordered = [...visible, ...outside];
    const batch = ordered.slice(0, Math.floor(limit));
    const selected = new Set(batch);
    this.pending = this.pending.filter((block) => !selected.has(block));
    return batch;
  }
}

function defaultIsInViewport({ node }: TextBlock): boolean {
  const element = node.parentElement;
  const view = node.ownerDocument.defaultView;
  if (!element || !view || !node.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= view.innerHeight &&
    rect.left <= view.innerWidth
  );
}
