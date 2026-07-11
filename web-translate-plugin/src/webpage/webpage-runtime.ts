import type { TranslationResult } from '../providers/openai/contracts';
import { isEligiblePage } from './eligibility';
import type { WebpageBackgroundMessage } from './messages';
import { MutationTranslationController } from './mutation-controller';
import { scanTextNodes } from './scan-text';
import { TranslationController } from './translation-controller';
import { ViewportQueue } from './viewport-queue';

export interface WebpageRuntimeStatus {
  enabled: boolean;
  count: number;
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
  controller: TranslationController;
  count: number;
  observer: MutationTranslationController;
  sessionId: string;
  styleElement: HTMLStyleElement | null;
}

export class WebpageTranslationRuntime {
  private session: ActiveSession | null = null;

  constructor(private readonly options: RuntimeOptions) {}

  status(): WebpageRuntimeStatus {
    return this.session?.active
      ? { enabled: true, count: this.session.count }
      : { enabled: false, count: 0 };
  }

  async enable(): Promise<WebpageRuntimeStatus> {
    if (this.session?.active) return this.status();
    const { document, url } = this.options;
    if (!document.body || !isEligiblePage(url, document)) {
      return { enabled: false, count: 0, reason: 'PAGE_NOT_ELIGIBLE' };
    }

    const blocks = scanTextNodes(document.body);
    const controller = new TranslationController(blocks);
    const session: ActiveSession = {
      active: true,
      controller,
      count: blocks.length,
      observer: null as unknown as MutationTranslationController,
      sessionId: this.options.createSessionId?.() ?? crypto.randomUUID(),
      styleElement: this.installStyle(),
    };
    session.observer = new MutationTranslationController(document.body, (roots) => {
      void this.translateRoots(session, roots).catch(() => undefined);
    });
    this.session = session;
    session.observer.start();

    try {
      await this.translateBlocks(session, blocks);
      return this.session === session ? this.status() : { enabled: false, count: 0 };
    } catch (error) {
      const wasCanceled = !session.active || isAbortError(error);
      if (session.active) await this.disable();
      if (wasCanceled) {
        return { enabled: false, count: 0 };
      }
      throw error;
    }
  }

  async disable(): Promise<WebpageRuntimeStatus> {
    const session = this.session;
    if (!session) return { enabled: false, count: 0 };
    session.active = false;
    this.session = null;
    session.observer.stop();
    session.controller.restore();
    session.styleElement?.remove();
    try {
      await this.options.sendMessage({
        type: 'translation:cancel',
        sessionId: session.sessionId,
      });
    } catch {
      // 页面恢复不应依赖后台确认；Service Worker 会在可达时处理中止。
    }
    return { enabled: false, count: 0 };
  }

  private async translateRoots(
    session: ActiveSession,
    roots: Node[],
  ): Promise<void> {
    if (!session.active || this.session !== session) return;
    const blocks = roots.flatMap((root) => scanTextNodes(root));
    if (blocks.length === 0) return;
    session.controller.add(blocks);
    session.count += blocks.length;
    await this.translateBlocks(session, blocks);
  }

  private async translateBlocks(
    session: ActiveSession,
    blocks: ReturnType<typeof scanTextNodes>,
  ): Promise<void> {
    const queue = new ViewportQueue(blocks);
    while (queue.size > 0 && session.active && this.session === session) {
      const batch = queue.takeBatch(20);
      const response = await this.options.sendMessage({
        type: 'translation:blocks',
        sessionId: session.sessionId,
        blocks: batch.map(({ id, original: text }) => ({ id, text })),
      });
      if (!session.active || this.session !== session) return;
      session.controller.apply(response as TranslationResult[]);
    }
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
