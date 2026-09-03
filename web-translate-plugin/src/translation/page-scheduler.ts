export type TranslationMode = 'on-demand' | 'full-document';
export type ReadingDirection = -1 | 0 | 1;

interface QueuedPage {
  priority: number;
  order: number;
}

export class PageScheduler {
  private readonly done = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly inFlight = new Set<number>();
  private readonly queued = new Map<number, QueuedPage>();
  private enqueueOrder = 0;

  constructor(
    private readonly pageCount: number,
    private readonly concurrency = 2,
    private mode: TranslationMode = 'full-document',
  ) {
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error('PAGE_COUNT_INVALID');
    }
  }

  take(): number | null {
    if (this.inFlight.size >= this.concurrency) return null;
    const queued = [...this.queued.entries()]
      .filter(([page]) => this.isAvailable(page))
      .sort(([, left], [, right]) => left.priority - right.priority || left.order - right.order)[0];
    const page = queued?.[0] ?? (this.mode === 'full-document' ? this.nextSequentialPage() : undefined);
    if (page === undefined) return null;
    this.queued.delete(page);
    this.inFlight.add(page);
    return page;
  }

  setMode(mode: TranslationMode): void {
    this.mode = mode;
  }

  getMode(): TranslationMode {
    return this.mode;
  }

  hydrateDone(pages: Iterable<number>): void {
    for (const page of pages) {
      if (!this.isValidPage(page)) continue;
      this.done.add(page);
      this.failed.delete(page);
      this.queued.delete(page);
    }
  }

  requestPage(page: number, priority = 0): boolean {
    if (!this.isAvailable(page)) return false;
    const current = this.queued.get(page);
    if (current && current.priority <= priority) return false;
    this.queued.set(page, { priority, order: current?.order ?? this.enqueueOrder++ });
    return true;
  }

  requestWindow(activePage: number, direction: ReadingDirection = 0): number[] {
    const offsets = direction < 0 ? [0, -1, -2, 1] : [0, 1, 2, -1];
    const pages = offsets
      .map((offset) => activePage + offset)
      .filter((page, index, values) => this.isValidPage(page) && values.indexOf(page) === index);
    pages.forEach((page, priority) => this.requestPage(page, priority));
    return pages;
  }

  markDone(page: number): void {
    this.inFlight.delete(page);
    this.failed.delete(page);
    this.done.add(page);
    this.queued.delete(page);
  }

  markFailed(page: number): void {
    this.inFlight.delete(page);
    this.queued.delete(page);
    this.failed.add(page);
  }

  retry(page: number): boolean {
    if (!this.failed.delete(page)) return false;
    this.requestPage(page, -1);
    return true;
  }

  private nextSequentialPage(): number | undefined {
    for (let page = 1; page <= this.pageCount; page += 1) {
      if (this.isAvailable(page)) return page;
    }
    return undefined;
  }

  private isAvailable(page: number): boolean {
    return this.isValidPage(page) && !this.done.has(page) && !this.failed.has(page) && !this.inFlight.has(page);
  }

  private isValidPage(page: number): boolean {
    return Number.isInteger(page) && page >= 1 && page <= this.pageCount;
  }
}
