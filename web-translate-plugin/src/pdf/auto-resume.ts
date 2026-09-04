import { pdfReadingIdentity, type PdfReadingStateStore } from './reading-state';

interface AutoResumePort {
  getTab(tabId: number): Promise<{ url?: string; incognito?: boolean }>;
  status(tabId: number): Promise<boolean>;
  mountRemembered(tabId: number, url: string): Promise<boolean>;
}

export class PdfAutoResumeController {
  private readonly generations = new Map<number, object>();
  private readonly pending = new Map<number, Promise<unknown>>();
  constructor(private readonly store: Pick<PdfReadingStateStore, 'get'>, private readonly port: AutoResumePort) {}

  invalidate(tabId: number): void { this.generations.set(tabId, {}); }
  forget(tabId: number): void { this.generations.delete(tabId); }
  capture(tabId: number): () => boolean {
    if (!this.generations.has(tabId)) this.invalidate(tabId);
    const generation = this.generations.get(tabId);
    return () => this.generations.get(tabId) === generation;
  }

  serialize<T>(tabId: number, action: () => Promise<T>): Promise<T> {
    const task = (this.pending.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(action);
    this.pending.set(tabId, task);
    void task.finally(() => { if (this.pending.get(tabId) === task) this.pending.delete(tabId); }).catch(() => undefined);
    return task;
  }

  restore(tabId: number, url: string): Promise<void> {
    if (!pdfReadingIdentity(url)) return Promise.resolve();
    if (!this.generations.has(tabId)) this.invalidate(tabId);
    const generation = this.generations.get(tabId);
    return this.serialize(tabId, async () => {
      const state = await this.store.get(url);
      if (!state?.enabled || this.generations.get(tabId) !== generation) return;
      const tab = await this.port.getTab(tabId);
      if (tab.incognito || tab.url !== url || await this.port.status(tabId)) return;
      if (this.generations.get(tabId) !== generation) return;
      // The adapter checks PDF content and pins injection to the inspected documentId.
      // Browser injection permission remains authoritative; background never requests it.
      await this.port.mountRemembered(tabId, url);
    });
  }
}
