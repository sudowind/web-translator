import { OWNED_SELECTOR } from './semantic-blocks';

export class MutationTranslationController {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private readonly onPresentationChange = () => this.schedule();
  constructor(private readonly root: Node, private readonly onRoots: (roots: Node[]) => void) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(records => {
      if (this.relevant(records)) this.schedule();
    });
    // Themes frequently use html classes or data-* attributes. Observe the entire root.
    this.observer.observe(this.root, { childList: true, subtree: true, characterData: true, attributes: true });
    this.root.ownerDocument?.defaultView?.addEventListener('resize', this.onPresentationChange);
    this.root.addEventListener('load', this.onPresentationChange, true);
  }

  flush(): void {
    if (!this.observer) return;
    if (this.relevant(this.observer.takeRecords())) this.dirty = true;
    if (!this.dirty) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
    this.onRoots([this.root]);
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => this.flush(), 80);
  }

  private relevant(records: MutationRecord[]): boolean {
    return records.some(record => {
      const parent = record.target instanceof Element ? record.target : record.target.parentElement;
      if (parent?.closest(OWNED_SELECTOR)) return false;
      if (record.type !== 'childList') return true;
      return record.removedNodes.length > 0 || Array.from(record.addedNodes).some(node =>
        !(node instanceof Element && node.matches(OWNED_SELECTOR)));
    });
  }

  stop(): void {
    this.observer?.disconnect(); this.observer = null;
    this.root.ownerDocument?.defaultView?.removeEventListener('resize', this.onPresentationChange);
    this.root.removeEventListener('load', this.onPresentationChange, true);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
  }
}
