import { isEligiblePage } from './eligibility';
import type { WebpageBackgroundMessage, WebpageProgressEvent } from './messages';
import { MutationTranslationController } from './mutation-controller';
import { BilingualController, type BilingualRecord } from './bilingual-controller';
import { summarizeTiming, type TimingSample } from './timing';
import { WebpageProgressView } from './progress-view';

export interface WebpageRuntimeStatus {
  enabled: boolean;
  count: number;
  translated?: number;
  failed?: number;
  translating?: number;
  mode?: 'reading' | 'article';
  reason?: 'PAGE_NOT_ELIGIBLE';
}
interface RuntimeOptions {
  document: Document;
  url: URL;
  sendMessage: (message: WebpageBackgroundMessage) => Promise<unknown>;
  createSessionId?: () => string;
  styleText?: string;
}
interface ActiveSession {
  active: boolean;
  controller: BilingualController;
  observer: MutationTranslationController;
  sessionId: string;
  styleElement: HTMLStyleElement | null;
  running: boolean;
  progress: WebpageProgressView;
  mode: 'reading' | 'article';
  direction: number;
  scrolling: boolean;
  cleanup: () => void;
  batch: BilingualRecord[];
  invalid: boolean;
  samples: TimingSample[];
  cached: Set<string>;
  started: number;
  firstBlockMs?: number;
  framePending?: boolean;
}
export class WebpageTranslationRuntime {
  private session: ActiveSession | null = null;
  constructor(private readonly options: RuntimeOptions) {}

  status(): WebpageRuntimeStatus {
    return this.session?.active
      ? { enabled: true, mode: this.session.mode, ...this.session.controller.status() }
      : { enabled: false, count: 0 };
  }

  async enable(): Promise<WebpageRuntimeStatus> {
    if (this.session?.active) return this.status();
    const { document, url } = this.options;
    if (!document.body || !isEligiblePage(url, document)) {
      return { enabled: false, count: 0, reason: 'PAGE_NOT_ELIGIBLE' };
    }
    const session: ActiveSession = {
      active: true,
      controller: new BilingualController(document.body, () => void this.pump(session)),
      observer: new MutationTranslationController(document.documentElement, () => {
        if (!session.active) return;
        if (!isEligiblePage(new URL(document.location?.href || url.href), document)) {
          void this.disable(); return;
        }
        if (!document.body) { void this.disable(); return; }
        session.controller.reconcile(document.body);
        this.update(session);
        void this.pump(session);
      }),
      sessionId: this.options.createSessionId?.() ?? crypto.randomUUID(),
      styleElement: this.installStyle(),
      running: false,
      progress: new WebpageProgressView(document, () => void this.disable(), {
        onMode: () => { session.mode = session.mode === 'reading' ? 'article' : 'reading'; this.update(session); void this.pump(session); },
        onClearCache: async () => { await this.options.sendMessage({ type: 'translation:clear-cache', sessionId: session.sessionId }); },
      }),
      mode: 'reading', direction: 1, scrolling: false, cleanup: () => undefined,
      batch: [], invalid: false, samples: [], cached: new Set(), started: performance.now(),
    };
    this.session = session;
    session.controller.reconcile();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousY = document.defaultView?.scrollY ?? 0;
    const onScroll = () => {
      const y = document.defaultView?.scrollY ?? 0;
      if (y !== previousY) session.direction = y > previousY ? 1 : -1;
      previousY = y; session.scrolling = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { session.scrolling = false; void this.pump(session); }, 400);
      this.update(session);
    };
    const onVisibility = () => { this.update(session); void this.pump(session); };
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('visibilitychange', onVisibility);
    session.cleanup = () => { if (timer) clearTimeout(timer); document.removeEventListener('scroll', onScroll, true); document.removeEventListener('visibilitychange', onVisibility); };
    this.update(session);
    session.observer.start();
    // Return promptly so slow providers do not block the popup's disable action.
    void this.pump(session);
    return this.status();
  }

  async disable(): Promise<WebpageRuntimeStatus> {
    const session = this.session;
    if (!session) return { enabled: false, count: 0 };
    session.active = false;
    this.session = null;
    session.observer.stop();
    session.cleanup();
    session.controller.clear();
    session.progress.destroy();
    session.styleElement?.remove();
    try {
      await this.options.sendMessage({ type: 'translation:cancel', sessionId: session.sessionId });
    } catch { /* Local cleanup must not depend on the service worker. */ }
    return { enabled: false, count: 0 };
  }

  private async pump(session: ActiveSession): Promise<void> {
    if (!session.active || session.running) return;
    session.running = true;
    try {
      while (session.active) {
        if (this.options.document.hidden || session.scrolling) { this.update(session); return; }
        const batch = session.controller.takeBatch(session.mode, session.direction);
        session.batch = batch; session.invalid = false;
        this.update(session);
        if (!batch.length) return;
        try {
          const response = await this.options.sendMessage({
            type: 'translation:blocks', sessionId: session.sessionId,
            blocks: batch.map(({ id, block }) => ({ id, text: block.text })),
          });
          if (!session.active) return;
          // Reject stale source snapshots even before the mutation debounce fires.
          session.observer.flush();
          if (!session.active) return;
          if (!Array.isArray(response) || response.length !== batch.length ||
            new Set(response.map((value) => value?.id)).size !== batch.length ||
            response.some((value) => !value || typeof value.text !== 'string' ||
              !batch.some((record) => record.id === value.id))) { session.invalid = true; throw new Error('WEBPAGE_RESPONSE_INVALID'); }
          if (session.invalid) throw new Error('WEBPAGE_RESPONSE_INVALID');
          for (const record of batch) session.controller.apply(record, response.find((value) => value.id === record.id).text);
          this.update(session);
        } catch (error) {
          if (!session.active) return;
          session.observer.flush();
          if (!session.active) return;
          // The terminal response also carries protocol failure if the progress event was lost.
          if (error instanceof Error && /^(TRANSLATION_(ID_|JSON_|SCHEMA_|RESPONSE_)|WEBPAGE_(RESPONSE_|INLINE_))/.test(error.message)) session.invalid = true;
          for (const record of batch) if (session.invalid || record.state !== 'done') session.controller.fail(record);
          this.update(session);
        } finally {
          session.batch = [];
        }
      }
    } finally { session.running = false; }
  }

  acceptProgress(event: WebpageProgressEvent): void {
    const session = this.session;
    if (!session?.active || event.sessionId !== session.sessionId || event.batchId !== session.batch[0]?.id) return;
    session.observer.flush();
    if (!session.active) return;
    if (event.invalid) {
      session.invalid = true;
      for (const record of session.batch) { session.controller.fail(record, '译文校验失败，请重试'); session.cached.delete(record.id); }
    }
    if (event.timing) { session.samples.push(event.timing); if (session.samples.length > 100) session.samples.shift(); }
    if (event.result && !session.invalid) {
      const record = session.batch.find(record => record.id === event.result!.id);
      if (record) {
        session.controller.apply(record, event.result.text);
        if (event.cached && record.state === 'done') session.cached.add(record.id);
      }
    }
    this.update(session);
  }

  private update(session: ActiveSession): void {
    const status = session.controller.status();
    if (status.translated && session.firstBlockMs === undefined && !session.framePending) {
      session.framePending = true;
      this.options.document.defaultView?.requestAnimationFrame(() => {
        session.framePending = false;
        if (session.active && session.controller.status().translated) {
          session.firstBlockMs = performance.now() - session.started; this.update(session);
        }
      });
    }
    session.progress.update({ ...status, mode: session.mode,
      paused: this.options.document.hidden || session.scrolling,
      metrics: `${session.firstBlockMs === undefined ? '首段尚未显示' : `首段 ${(session.firstBlockMs / 1000).toFixed(2)}s`} · 缓存命中 ${session.cached.size} 段 · ${summarizeTiming(session.samples)}`,
    });
  }

  private installStyle(): HTMLStyleElement | null {
    if (!this.options.styleText) return null;
    const style = this.options.document.createElement('style');
    style.dataset.webTranslateUi = '';
    style.dataset.webTranslateStyle = '';
    style.textContent = this.options.styleText;
    (this.options.document.head ?? this.options.document.documentElement).append(style);
    return style;
  }
}
