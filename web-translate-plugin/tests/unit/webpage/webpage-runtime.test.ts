// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebpageTranslationRuntime } from '../../../src/webpage/webpage-runtime';
import type { WebpageBackgroundMessage } from '../../../src/webpage/messages';

let runtime: WebpageTranslationRuntime;
const outputs = () => document.querySelectorAll('[data-web-translate-block]');
const settled = () => new Promise(resolve => setTimeout(resolve, 130));
const translate = (message: WebpageBackgroundMessage) => message.type === 'translation:blocks'
  ? message.blocks.map(({ id, text }) => ({ id, text: '译文：' + text })) : { canceled: true };
function setup(send = vi.fn(async (message: WebpageBackgroundMessage): Promise<unknown> => translate(message))) {
  runtime = new WebpageTranslationRuntime({ document, url: new URL('https://article.example/story'),
    sendMessage: send, styleText: '[data-web-translate-block]{display:block}' });
  return send;
}
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(async () => { await runtime?.disable(); });
describe('网页对照生命周期', () => {
  it('整块翻译不修改原文与事件，重复启用不重复请求，关闭仅删除译文', async () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong> <a href="#next">next</a></p><button>Action</button>';
    const original = document.body.innerHTML;
    const strong = document.querySelector('strong');
    const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click);
    const send = setup(); await runtime.enable(); await settled();
    expect(outputs()).toHaveLength(1);
    expect(document.querySelector('p')!.firstChild!.textContent).toBe('Hello ');
    expect(document.querySelector('strong')).toBe(strong);
    expect(outputs()[0].querySelector('strong')?.textContent).toBe('world');
    document.querySelector('button')!.click(); expect(click).toHaveBeenCalledOnce();
    await runtime.enable(); await settled(); expect(send).toHaveBeenCalledOnce();
    expect(runtime.status()).toMatchObject({ translated: 1, failed: 0, count: 1 });
    await runtime.disable(); expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector('[data-web-translate-style]')).toBeNull();
  });
  it('嵌套列表的译文紧跟自己的文字，父项不包含子项译文', async () => {
    document.body.innerHTML = '<ul><li>Parent<ul><li>Child</li></ul></li></ul>';
    setup(); await runtime.enable(); await settled();
    expect(outputs()).toHaveLength(2);
    expect(document.querySelector('li')!.childNodes[1]).toBe(outputs()[0]);
    expect(outputs()[0].textContent).toBe('译文：Parent');
  });
  it('更新已有 Text、替换元素和新增内容后仅保留最新译文', async () => {
    document.body.innerHTML = '<p>Hello</p>'; const send = setup();
    await runtime.enable(); await settled();
    document.querySelector('p')!.firstChild!.textContent = 'Updated';
    await settled(); expect(outputs()).toHaveLength(1); expect(outputs()[0].textContent).toBe('译文：Updated');
    document.querySelector('p')!.innerHTML = 'Replaced <em>text</em>';
    await settled(); expect(outputs()).toHaveLength(1); expect(outputs()[0].querySelector('em')?.textContent).toBe('text');
    const p = document.createElement('p'); p.textContent = 'Added'; document.body.append(p);
    await settled(); expect(outputs()).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(4);
    await runtime.disable(); expect(document.body.textContent).toBe('Replaced textAdded');
  });
  it('移动原块不重新请求，删除源块时清理译文，重新挂载可翻译', async () => {
    document.body.innerHTML = '<div id="a"><p>Hello</p></div><div id="b"></div>';
    const send = setup(); await runtime.enable(); await settled();
    const p = document.querySelector('p')!;
    document.querySelector('#b')!.append(p); await settled();
    expect(outputs()).toHaveLength(1); expect(send).toHaveBeenCalledOnce();
    p.remove(); await settled(); expect(runtime.status().count).toBe(0);
    expect(p.querySelector('[data-web-translate-block]')).toBeNull();
    document.querySelector('#a')!.append(p); await settled(); expect(outputs()).toHaveLength(1);
  });
  it('隐藏、显示和链接属性变化同步更新，移除译文后无需重复请求即可补回', async () => {
    document.body.innerHTML = '<p>Hello <a href="https://a.example">link</a></p>';
    const send = setup(); await runtime.enable(); await settled();
    const p = document.querySelector('p')!;
    p.hidden = true; await settled(); expect(outputs()).toHaveLength(0);
    p.hidden = false; await settled(); expect(outputs()).toHaveLength(1);
    p.querySelector('a')!.href = 'https://b.example'; await settled();
    expect(outputs()[0].querySelector('a')?.href).toBe('https://b.example/');
    const count = send.mock.calls.length;
    outputs()[0].remove(); await settled(); expect(outputs()).toHaveLength(1);
    expect(send.mock.calls.length).toBe(count);
  });
  it('原文在请求中变化时，迟到结果不插入并为新内容发起请求', async () => {
    document.body.innerHTML = '<p>Old</p>';
    let finish!: (value: unknown) => void;
    const send = vi.fn(async (message: WebpageBackgroundMessage): Promise<unknown> => translate(message));
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    setup(send); await runtime.enable();
    document.querySelector('p')!.firstChild!.textContent = 'New';
    finish(translate(send.mock.calls[0][0]));
    await settled();
    expect(outputs()).toHaveLength(1); expect(outputs()[0].textContent).toBe('译文：New');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('html 与 data 主题变化同步颜色且不重译，替换 body 后继续工作', async () => {
    const style = document.createElement('style');
    style.textContent = 'p{color:rgb(0,0,0)} html.dark p{color:rgb(255,255,255)} body[data-theme="blue"] p{color:rgb(0,0,255)}';
    document.head.append(style); document.body.innerHTML = '<p>Hello <strong>world</strong></p>';
    const send = setup(); await runtime.enable(); await settled();
    document.documentElement.classList.add('dark'); await settled();
    expect((outputs()[0] as HTMLElement).style.color).toBe('rgb(255, 255, 255)');
    document.body.dataset.theme = 'blue'; await settled();
    expect((outputs()[0] as HTMLElement).style.color).toBe('rgb(0, 0, 255)');
    expect(send).toHaveBeenCalledOnce();
    const previousBody = document.body;
    const nextBody = document.createElement('body'); nextBody.innerHTML = '<p>New body</p>';
    document.body.replaceWith(nextBody); await settled();
    expect(outputs()[0].textContent).toBe('译文：New body');
    expect(previousBody.querySelector('[data-web-translate-block]')).toBeNull();
    document.documentElement.classList.remove('dark'); style.remove();
  });
  it('关闭不等待在途请求，忽略迟到响应，清理后网站更新仍保留', async () => {
    document.body.innerHTML = '<p>Old</p>';
    let finish!: (value: unknown) => void;
    const send = vi.fn(async (message: WebpageBackgroundMessage): Promise<unknown> => translate(message));
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    setup(send); await runtime.enable();
    document.querySelector('p')!.firstChild!.textContent = 'Latest';
    await runtime.disable(); finish(translate(send.mock.calls[0][0])); await settled();
    expect(outputs()).toHaveLength(0); expect(document.body.textContent).toBe('Latest');
    expect(send.mock.calls.at(-1)?.[0].type).toBe('translation:cancel');
  });
  it('服务尚未响应时即时显示进度，可从页面停止且迟到响应不恢复 UI', async () => {
    document.body.innerHTML = '<main><p>Waiting article</p></main>';
    let finish!: (value: unknown) => void;
    const send = vi.fn(async (message: WebpageBackgroundMessage): Promise<unknown> => translate(message));
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    setup(send); await runtime.enable();
    const host = document.querySelector('[data-web-translate-progress]')!;
    expect(host.shadowRoot!.textContent).toContain('正在翻译 · 已完成 0/1 段');
    expect(outputs()).toHaveLength(0);
    host.shadowRoot!.querySelector('button')!.click();
    expect(document.querySelector('[data-web-translate-progress]')).toBeNull();
    expect(runtime.status().enabled).toBe(false);
    finish(translate(send.mock.calls[0][0])); await settled();
    expect(outputs()).toHaveLength(0);
    expect(document.body.textContent).toBe('Waiting article');
  });
  it('网络或格式失败仅影响当前段，点击可重试', async () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong></p>';
    const send = vi.fn(async (message: WebpageBackgroundMessage): Promise<unknown> => translate(message));
    send.mockRejectedValueOnce(new Error('network')); setup(send);
    await runtime.enable(); await settled();
    expect(runtime.status().failed).toBe(1);
    expect(document.querySelector('p')!.firstChild!.textContent).toBe('Hello ');
    outputs()[0].querySelector('button')!.click(); await settled();
    expect(runtime.status().translated).toBe(1);
    expect(outputs()[0].querySelector('strong')?.textContent).toBe('world');
  });
  it('标记缺失显示错误，不注入模型 HTML', async () => {
    document.body.innerHTML = '<p><strong>Hello</strong></p>';
    setup(vi.fn(async message => message.type === 'translation:blocks'
      ? message.blocks.map(b => ({ id: b.id, text: '<img src=x onerror=bad()>' })) : {}));
    await runtime.enable(); await settled();
    expect(runtime.status().failed).toBe(1); expect(document.querySelector('img')).toBeNull();
  });
  it('敏感页面拒绝启用，启用中新增密码框会清理并停止', async () => {
    document.body.innerHTML = '<p>Hello</p><input type="password">';
    setup(); expect(await runtime.enable()).toMatchObject({ enabled: false, reason: 'PAGE_NOT_ELIGIBLE' });
    document.querySelector('input')!.remove(); await runtime.enable(); await settled();
    const input = document.createElement('input'); input.type = 'password'; document.body.append(input);
    await settled(); expect(runtime.status().enabled).toBe(false); expect(outputs()).toHaveLength(0);
  });
});
