import { isEligiblePage } from './eligibility';
import type { WebpageBackgroundMessage } from './messages';
import { MutationTranslationController } from './mutation-controller';
import { BilingualController } from './bilingual-controller';
import { WebpageProgressView } from './progress-view';

export interface WebpageRuntimeStatus {
  enabled: boolean;
  count: number;
  translated?: number;
  failed?: number;
  translating?: number;
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
}
export class WebpageTranslationRuntime {
  private session: ActiveSession | null = null;
  constructor(private readonly options: RuntimeOptions) {}

  status(): WebpageRuntimeStatus {
    return this.session?.active
      ? { enabled: true, ...this.session.controller.status() }
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
        session.progress.update(session.controller.status());
        void this.pump(session);
      }),
      sessionId: this.options.createSessionId?.() ?? crypto.randomUUID(),
      styleElement: this.installStyle(),
      running: false,
      progress: new WebpageProgressView(document, () => void this.disable()),
    };
    this.session = session;
    session.controller.reconcile();
    session.progress.update(session.controller.status());
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
        const batch = session.controller.takeBatch();
        session.progress.update(session.controller.status());
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
              !batch.some((record) => record.id === value.id))) throw new Error('WEBPAGE_RESPONSE_INVALID');
          for (const record of batch) session.controller.apply(record, response.find((value) => value.id === record.id).text);
          session.progress.update(session.controller.status());
        } catch {
          if (!session.active) return;
          session.observer.flush();
          if (!session.active) return;
          for (const record of batch) session.controller.fail(record);
          session.progress.update(session.controller.status());
        }
      }
    } finally { session.running = false; }
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
