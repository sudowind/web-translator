export interface WebpageProgress {
  count: number;
  translated?: number;
  failed?: number;
  translating?: number;
}

export function webpageProgressText(status: WebpageProgress): string {
  const done = status.translated ?? 0;
  const failed = status.failed ?? 0;
  if (status.count === 0) return '未找到可翻译的正文';
  if (done + failed >= status.count) return failed
    ? `翻译结束 · 完成 ${done}/${status.count} 段 · 失败 ${failed} 段，可在原文处重试`
    : `翻译完成 · ${done} 段`;
  return `正在翻译 · 已完成 ${done}/${status.count} 段` +
    (failed ? ` · 失败 ${failed} 段` : '');
}

// Shadow DOM keeps website button/style rules from hiding or restyling progress.
export class WebpageProgressView {
  private readonly host: HTMLElement;
  private readonly text: HTMLElement;
  private timer?: ReturnType<typeof setInterval>;
  private status: WebpageProgress = { count: 0 };
  private waitingSince = Date.now();

  constructor(document: Document, onClose: () => void) {
    this.host = document.createElement('div');
    this.host.dataset.webTranslateUi = '';
    this.host.dataset.webTranslateProgress = '';
    this.host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block;max-width:calc(100vw - 32px);';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{color-scheme:light dark}section{font:14px/1.5 system-ui,sans-serif;color:#f8fafc;background:#1e293b;border:1px solid #64748b;border-radius:8px;padding:10px 12px;box-shadow:0 3px 16px #0003;display:flex;align-items:center;gap:12px;max-width:440px}button{font:inherit;color:inherit;background:transparent;border:1px solid #94a3b8;border-radius:4px;padding:4px 8px;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}';
    const panel = document.createElement('section');
    panel.setAttribute('aria-label', '网页翻译进度');
    this.text = document.createElement('span');
    this.text.setAttribute('role', 'status');
    this.text.setAttribute('aria-live', 'polite');
    this.text.textContent = '正在识别网页正文…';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '关闭翻译';
    close.addEventListener('click', onClose);
    panel.append(this.text, close); shadow.append(style, panel);
    document.documentElement.append(this.host);
  }

  update(status: WebpageProgress): void {
    if (status.translated !== this.status.translated || status.failed !== this.status.failed) this.waitingSince = Date.now();
    this.status = status;
    const pending = status.count > (status.translated ?? 0) + (status.failed ?? 0);
    if (pending && !this.timer) this.timer = setInterval(() => this.render(), 1_000);
    if (!pending && this.timer) { clearInterval(this.timer); this.timer = undefined; }
    this.render();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.host.remove();
  }

  private render(): void {
    const pending = this.status.count > (this.status.translated ?? 0) + (this.status.failed ?? 0);
    const seconds = Math.floor((Date.now() - this.waitingSince) / 1000);
    const waiting = pending && seconds >= 10 ? ` · 等待翻译服务返回（${Math.floor(seconds / 5) * 5} 秒）` : '';
    const next = webpageProgressText(this.status) + waiting;
    if (this.text.textContent !== next) this.text.textContent = next;
  }
}
