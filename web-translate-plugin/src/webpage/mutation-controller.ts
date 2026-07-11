export class MutationTranslationController {
  private observer: MutationObserver | null = null;

  constructor(
    private readonly root: Node,
    private readonly onRoots: (roots: Node[]) => void,
  ) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      const candidates = records.flatMap((record) => [...record.addedNodes])
        .filter(isTranslatableRoot);
      const roots = [...new Set(candidates)].filter(
        (candidate, index, all) =>
          !all.some(
            (other, otherIndex) =>
              index !== otherIndex && other.contains(candidate),
          ),
      );
      if (roots.length > 0) this.onRoots(roots);
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

function isTranslatableRoot(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return !node.parentElement?.closest('[data-web-translate-ui]');
  }
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    !(node as Element).closest('[data-web-translate-ui]')
  );
}
