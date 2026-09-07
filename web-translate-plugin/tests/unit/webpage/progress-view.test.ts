// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { WebpageProgressView } from '../../../src/webpage/progress-view';
let view: WebpageProgressView;
afterEach(() => { view?.destroy(); vi.useRealTimers(); });
it('慢请求显示等待提示，完成或销毁后清理计时器', () => {
  vi.useFakeTimers();
  view = new WebpageProgressView(document, () => {});
  view.update({ count: 4, translated: 0, failed: 0, translating: 3 });
  vi.advanceTimersByTime(11_000);
  const host = document.querySelector('[data-web-translate-progress]')!;
  expect(host.shadowRoot!.textContent).toContain('等待翻译服务返回（10 秒）');
  view.update({ count: 4, translated: 4, failed: 0 });
  expect(host.shadowRoot!.textContent).toContain('翻译完成 · 4 段');
  expect(host.shadowRoot!.textContent).not.toContain('等待翻译服务');
  expect(vi.getTimerCount()).toBe(0);
  view.destroy(); expect(document.querySelector('[data-web-translate-progress]')).toBeNull();
});
it('无正文和部分失败明确提示而非静默', () => {
  view = new WebpageProgressView(document, () => {});
  view.update({ count: 0 });
  const host = document.querySelector('[data-web-translate-progress]')!;
  expect(host.shadowRoot!.textContent).toContain('未找到可翻译的正文');
  view.update({ count: 4, translated: 3, failed: 1 });
  expect(host.shadowRoot!.textContent).toContain('失败 1 段');
});
