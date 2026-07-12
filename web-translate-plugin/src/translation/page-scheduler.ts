export class PageScheduler {
  private readonly done = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly pageCount: number,
    private readonly concurrency = 2,
  ) {
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error('PAGE_COUNT_INVALID');
    }
  }

  take(): number | null {
    if (this.inFlight.size >= this.concurrency) return null;
    const page = Array.from({ length: this.pageCount }, (_, index) => index + 1).find((candidate) =>
      !this.done.has(candidate) &&
      !this.failed.has(candidate) &&
      !this.inFlight.has(candidate));
    if (page === undefined) return null;
    this.inFlight.add(page);
    return page;
  }

  markDone(page: number): void {
    this.inFlight.delete(page);
    this.failed.delete(page);
    this.done.add(page);
  }

  markFailed(page: number): void {
    this.inFlight.delete(page);
    this.failed.add(page);
  }

  retry(page: number): void {
    if (this.failed.has(page)) this.failed.delete(page);
  }
}
