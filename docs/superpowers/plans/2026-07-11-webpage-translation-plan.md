# 普通网页翻译实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施；所有步骤使用复选框跟踪。

**目标：** 在已通过构建的 WXT 插件中实现用户主动启用的英译中原位网页翻译，保留页面交互，并支持动态内容、查看原文和完整恢复。

**架构：** 内容脚本负责发现、调度和替换文本节点，Service Worker 只接受结构化翻译请求并使用本地设置的 OpenAI 兼容接口。原文映射保存在当前页面内存中，设置保存在 `chrome.storage.local`；视口附近的语义块优先发送。

**技术栈：** WXT、React、TypeScript、Vitest、Playwright、Chrome Manifest V3、原生 DOM API。

## 全局约束

- 执行前必须完成 PDF 探针计划中的插件骨架任务。
- 所有 plan/spec 使用中文。
- 普通网页翻译默认关闭，只能由用户主动启用。
- 只修改文本节点，不替换承载事件和状态的父元素。
- 跳过密码、支付、浏览器内部页、后台管理页、输入区、代码区和插件自身 UI。
- OpenAI API Key 不进入页面 DOM、内容脚本消息、日志或诊断输出。
- 首版仅提供英译中主界面，但接口保留语言参数。

---

## 文件结构

```text
web-translate-plugin/
├─ entrypoints/
│  ├─ background.ts                       # 注册安全翻译消息
│  ├─ webpage.content/
│  │  ├─ index.ts                         # 页面翻译入口
│  │  └─ original-tooltip.css             # 原文悬停样式
│  ├─ popup/App.tsx                       # 启用、恢复与状态
│  └─ options/
│     ├─ index.html
│     ├─ main.tsx
│     └─ App.tsx                          # Provider 设置
├─ src/
│  ├─ settings/
│  │  ├─ schema.ts
│  │  └─ store.ts
│  ├─ providers/openai/
│  │  ├─ contracts.ts
│  │  └─ client.ts
│  └─ webpage/
│     ├─ contracts.ts
│     ├─ eligibility.ts
│     ├─ scan-text.ts
│     ├─ translation-controller.ts
│     ├─ viewport-queue.ts
│     └─ mutation-controller.ts
└─ tests/
   ├─ unit/settings/store.test.ts
   ├─ unit/providers/openai/client.test.ts
   ├─ unit/webpage/eligibility.test.ts
   ├─ unit/webpage/scan-text.test.ts
   ├─ unit/webpage/translation-controller.test.ts
   └─ e2e/webpage-translation.spec.ts
```

### 任务 1：实现设置存储与 OpenAI 兼容翻译 Provider

**文件：**
- 创建：`web-translate-plugin/src/settings/schema.ts`
- 创建：`web-translate-plugin/src/settings/store.ts`
- 创建：`web-translate-plugin/src/providers/openai/contracts.ts`
- 创建：`web-translate-plugin/src/providers/openai/client.ts`
- 创建：`web-translate-plugin/tests/unit/settings/store.test.ts`
- 创建：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`

**接口：**
- 产出：`getSettings()`、`saveSettings(settings)`。
- 产出：`OpenAiTranslationClient.translate(request, signal)`。

- [ ] **步骤 1：先写设置与请求序列化失败测试**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSettings, saveSettings } from '../../../src/settings/store';
import { OpenAiTranslationClient } from '../../../src/providers/openai/client';

beforeEach(() => fakeBrowser.reset());

it('设置只存入 local storage', async () => {
  const settings = { openAi: { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', model: 'translate-model' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' } as const;
  await saveSettings(settings);
  expect(await getSettings()).toEqual(settings);
});

it('翻译结果必须按 block id 返回', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":"b1","text":"你好"}]}' } }] }), { status: 200 }));
  const client = new OpenAiTranslationClient({ baseUrl: 'https://api.example.com/v1', apiKey: 'secret', model: 'm' }, fetcher);
  await expect(client.translate({ sourceLanguage: 'en', targetLanguage: 'zh-CN', blocks: [{ id: 'b1', text: 'hello' }] })).resolves.toEqual([{ id: 'b1', text: '你好' }]);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/settings/store.test.ts tests/unit/providers/openai/client.test.ts`  
预期：失败，提示模块不存在。

- [ ] **步骤 3：实现设置和 Provider**

```ts
// src/settings/schema.ts
export interface OpenAiSettings { baseUrl: string; apiKey: string; model: string }
export interface ExtensionSettings {
  openAi: OpenAiSettings;
  sourceLanguage: string;
  targetLanguage: string;
}
export const defaultSettings: ExtensionSettings = { openAi: { baseUrl: '', apiKey: '', model: '' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' };
```

```ts
// src/settings/store.ts
import { storage } from 'wxt/utils/storage';
import { defaultSettings, type ExtensionSettings } from './schema';
const item = storage.defineItem<ExtensionSettings>('local:settings', { fallback: defaultSettings });
export const getSettings = () => item.getValue();
export const saveSettings = (value: ExtensionSettings) => item.setValue(value);
```

```ts
// src/providers/openai/contracts.ts
export interface TranslationBlock { id: string; text: string }
export interface TranslateRequest { sourceLanguage: string; targetLanguage: string; blocks: TranslationBlock[] }
export interface TranslationResult { id: string; text: string }
```

```ts
// src/providers/openai/client.ts
import type { OpenAiSettings } from '../../settings/schema';
import type { TranslateRequest, TranslationResult } from './contracts';

export class OpenAiTranslationClient {
  constructor(private readonly settings: OpenAiSettings, private readonly fetcher: typeof fetch = fetch) {}
  async translate(request: TranslateRequest, signal?: AbortSignal): Promise<TranslationResult[]> {
    const response = await this.fetcher(`${this.settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.settings.apiKey}` },
      body: JSON.stringify({ model: this.settings.model, temperature: 0, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `把输入块从 ${request.sourceLanguage} 翻译为 ${request.targetLanguage}，保留 id，仅返回 {"translations":[{"id":"","text":""}]}` },
        { role: 'user', content: JSON.stringify({ blocks: request.blocks }) },
      ] }),
    });
    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
    const body = await response.json();
    const parsed = JSON.parse(body.choices[0].message.content) as { translations: TranslationResult[] };
    const expected = new Set(request.blocks.map((block) => block.id));
    if (parsed.translations.some((item) => !expected.has(item.id))) throw new Error('OPENAI_INVALID_BLOCK_ID');
    return parsed.translations;
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`npm test -- tests/unit/settings/store.test.ts tests/unit/providers/openai/client.test.ts`  
预期：2 个测试通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/settings web-translate-plugin/src/providers web-translate-plugin/tests/unit/settings web-translate-plugin/tests/unit/providers
git commit -m "feat: add translation provider settings"
```

### 任务 2：实现页面资格判断与文本扫描

**文件：**
- 创建：`web-translate-plugin/src/webpage/contracts.ts`
- 创建：`web-translate-plugin/src/webpage/eligibility.ts`
- 创建：`web-translate-plugin/src/webpage/scan-text.ts`
- 创建：`web-translate-plugin/tests/unit/webpage/eligibility.test.ts`
- 创建：`web-translate-plugin/tests/unit/webpage/scan-text.test.ts`

**接口：**
- 产出：`isEligiblePage(location, document): boolean`。
- 产出：`scanTextNodes(root): TextBlock[]`，每个块保留 `Text` 节点引用和原文。

- [ ] **步骤 1：先写过滤测试**

```ts
import { expect, it } from 'vitest';
import { isEligiblePage } from '../../../src/webpage/eligibility';
import { scanTextNodes } from '../../../src/webpage/scan-text';

it('拒绝支付与密码页面', () => {
  document.body.innerHTML = '<input type="password">';
  expect(isEligiblePage(new URL('https://example.com/login'), document)).toBe(false);
});

it('只扫描可翻译文本', () => {
  document.body.innerHTML = '<main><p>Hello world</p><pre>const x = 1</pre><button>Submit</button></main>';
  expect(scanTextNodes(document.body).map((block) => block.original)).toEqual(['Hello world', 'Submit']);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/webpage/eligibility.test.ts tests/unit/webpage/scan-text.test.ts`  
预期：失败，提示模块不存在。

- [ ] **步骤 3：实现资格判断与扫描器**

```ts
// src/webpage/contracts.ts
export interface TextBlock { id: string; node: Text; original: string; translated?: string }
```

```ts
// src/webpage/eligibility.ts
export function isEligiblePage(url: URL, doc: Document): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (doc.querySelector('input[type="password"]')) return false;
  return !/(payment|checkout|admin)/i.test(`${url.hostname}${url.pathname}`);
}
```

```ts
// src/webpage/scan-text.ts
import type { TextBlock } from './contracts';
const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP']);
let sequence = 0;

export function scanTextNodes(root: Node): TextBlock[] {
  const blocks: TextBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? '';
      if (!parent || !text || excluded.has(parent.tagName) || parent.isContentEditable || parent.closest('[data-web-translate-root]')) return NodeFilter.FILTER_REJECT;
      return /[A-Za-z]{2}/.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    blocks.push({ id: `web-${++sequence}`, node, original: node.data });
  }
  return blocks;
}
```

- [ ] **步骤 4：运行测试**

运行：`npm test -- tests/unit/webpage/eligibility.test.ts tests/unit/webpage/scan-text.test.ts`  
预期：2 个测试通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/webpage web-translate-plugin/tests/unit/webpage
git commit -m "feat: scan eligible webpage text"
```

### 任务 3：实现视口优先队列与原位替换控制器

**文件：**
- 创建：`web-translate-plugin/src/webpage/viewport-queue.ts`
- 创建：`web-translate-plugin/src/webpage/translation-controller.ts`
- 创建：`web-translate-plugin/tests/unit/webpage/translation-controller.test.ts`

**接口：**
- 产出：`ViewportQueue.takeBatch(limit): TextBlock[]`。
- 产出：`TranslationController.apply(results)`、`restore()`、`revealOriginal(id)`。

- [ ] **步骤 1：先写替换与恢复测试**

```ts
import { expect, it } from 'vitest';
import { TranslationController } from '../../../src/webpage/translation-controller';

it('只修改文本并可完整恢复', () => {
  document.body.innerHTML = '<button id="b">Submit</button>';
  const button = document.querySelector('button')!;
  const node = button.firstChild as Text;
  const controller = new TranslationController([{ id: 'b1', node, original: 'Submit' }]);
  controller.apply([{ id: 'b1', text: '提交' }]);
  expect(button.textContent).toBe('提交');
  controller.restore();
  expect(button.textContent).toBe('Submit');
  expect(document.querySelector('button')).toBe(button);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/webpage/translation-controller.test.ts`  
预期：失败，提示控制器不存在。

- [ ] **步骤 3：实现队列与控制器**

```ts
// src/webpage/translation-controller.ts
import type { TranslationResult } from '../providers/openai/contracts';
import type { TextBlock } from './contracts';

export class TranslationController {
  private readonly byId = new Map<string, TextBlock>();
  constructor(blocks: TextBlock[]) { blocks.forEach((block) => this.byId.set(block.id, block)); }
  apply(results: TranslationResult[]) {
    for (const result of results) {
      const block = this.byId.get(result.id);
      if (!block || !block.node.isConnected) continue;
      block.translated = result.text;
      block.node.data = result.text;
      block.node.parentElement?.setAttribute('data-web-translate-id', result.id);
      block.node.parentElement?.setAttribute('data-web-translate-original', block.original);
    }
  }
  revealOriginal(id: string) { return this.byId.get(id)?.original ?? null; }
  restore() {
    for (const block of this.byId.values()) {
      if (block.node.isConnected) block.node.data = block.original;
      block.node.parentElement?.removeAttribute('data-web-translate-id');
      block.node.parentElement?.removeAttribute('data-web-translate-original');
    }
  }
}
```

```ts
// src/webpage/viewport-queue.ts
import type { TextBlock } from './contracts';
export class ViewportQueue {
  private pending: TextBlock[];
  constructor(blocks: TextBlock[]) {
    this.pending = [...blocks].sort((a, b) => distance(a.node) - distance(b.node));
  }
  takeBatch(limit: number) { return this.pending.splice(0, limit); }
  get size() { return this.pending.length; }
}
function distance(node: Text) {
  const rect = node.parentElement?.getBoundingClientRect();
  if (!rect) return Number.MAX_SAFE_INTEGER;
  if (rect.bottom >= 0 && rect.top <= innerHeight) return 0;
  return Math.min(Math.abs(rect.top), Math.abs(rect.bottom - innerHeight));
}
```

- [ ] **步骤 4：运行测试**

运行：`npm test -- tests/unit/webpage/translation-controller.test.ts`  
预期：测试通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/webpage web-translate-plugin/tests/unit/webpage
git commit -m "feat: translate and restore text nodes"
```

### 任务 4：接通安全消息与网页内容脚本

**文件：**
- 修改：`web-translate-plugin/entrypoints/background.ts`
- 创建：`web-translate-plugin/entrypoints/webpage.content/index.ts`
- 创建：`web-translate-plugin/entrypoints/webpage.content/original-tooltip.css`
- 修改：`web-translate-plugin/entrypoints/popup/App.tsx`

**接口：**
- 消费：`OpenAiTranslationClient.translate()`、`scanTextNodes()`、`ViewportQueue`、`TranslationController`。
- 产出：消息 `webpage:enable`、`webpage:disable`、`translation:blocks`。

- [ ] **步骤 1：在 Service Worker 注册固定用途翻译消息**

```ts
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.type !== 'translation:blocks') return;
  if (sender.tab?.id === undefined) throw new Error('TRANSLATION_REQUIRES_TAB');
  const settings = await getSettings();
  const client = new OpenAiTranslationClient(settings.openAi);
  return client.translate({ sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, blocks: message.blocks });
});
```

- [ ] **步骤 2：实现内容脚本生命周期**

```ts
// entrypoints/webpage.content/index.ts
import './original-tooltip.css';
import { isEligiblePage } from '../../src/webpage/eligibility';
import { scanTextNodes } from '../../src/webpage/scan-text';
import { TranslationController } from '../../src/webpage/translation-controller';
import { ViewportQueue } from '../../src/webpage/viewport-queue';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], registration: 'runtime',
  main() {
    let controller: TranslationController | null = null;
    browser.runtime.onMessage.addListener(async (message) => {
      if (message?.type === 'webpage:disable') { controller?.restore(); controller = null; return { enabled: false }; }
      if (message?.type !== 'webpage:enable') return;
      if (!isEligiblePage(new URL(location.href), document)) throw new Error('PAGE_NOT_ELIGIBLE');
      const blocks = scanTextNodes(document.body);
      controller = new TranslationController(blocks);
      const queue = new ViewportQueue(blocks);
      while (queue.size > 0) {
        const batch = queue.takeBatch(20);
        const results = await browser.runtime.sendMessage({ type: 'translation:blocks', blocks: batch.map(({ id, original: text }) => ({ id, text })) });
        controller.apply(results);
      }
      return { enabled: true, count: blocks.length };
    });
  },
});
```

- [ ] **步骤 3：增加原文悬停样式**

```css
[data-web-translate-original] { position: relative; }
[data-web-translate-original]:hover::after {
  content: attr(data-web-translate-original);
  position: absolute; z-index: 2147483647; left: 0; top: 100%;
  max-width: 36rem; padding: .5rem .75rem; color: #fff; background: #111827;
  border-radius: .375rem; white-space: normal; font: 13px/1.5 system-ui;
}
```

- [ ] **步骤 4：Popup 注入脚本并启用/恢复**

```tsx
async function sendToActive(type: 'webpage:enable' | 'webpage:disable') {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab.id === undefined) throw new Error('缺少活动标签页');
  await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/webpage.js'] });
  return browser.tabs.sendMessage(tab.id, { type });
}
```

运行：`npm run check`  
预期：类型检查、单测和构建通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/entrypoints web-translate-plugin/src
git commit -m "feat: activate in-place webpage translation"
```

### 任务 5：支持动态内容与中止正在进行的翻译

**文件：**
- 创建：`web-translate-plugin/src/webpage/mutation-controller.ts`
- 创建：`web-translate-plugin/tests/unit/webpage/mutation-controller.test.ts`
- 修改：`web-translate-plugin/entrypoints/webpage.content/index.ts`

**接口：**
- 产出：`MutationTranslationController.start()`、`stop()`。
- 关闭翻译后不得再发送或应用新译文。

- [ ] **步骤 1：先写动态节点去重测试**

```ts
import { expect, it, vi } from 'vitest';
import { MutationTranslationController } from '../../../src/webpage/mutation-controller';

it('只上报新增且未处理的根节点', async () => {
  const onRoots = vi.fn();
  const controller = new MutationTranslationController(document.body, onRoots);
  controller.start();
  const p = document.createElement('p'); p.textContent = 'New article text'; document.body.append(p);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onRoots).toHaveBeenCalledTimes(1);
  controller.stop();
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/webpage/mutation-controller.test.ts`  
预期：失败，提示模块不存在。

- [ ] **步骤 3：实现观察器**

```ts
export class MutationTranslationController {
  private observer: MutationObserver | null = null;
  constructor(private readonly root: Node, private readonly onRoots: (roots: Node[]) => void) {}
  start() {
    this.observer = new MutationObserver((records) => {
      const roots = records.flatMap((record) => [...record.addedNodes]).filter((node) => node.nodeType === Node.ELEMENT_NODE && !(node as Element).closest('[data-web-translate-root]'));
      if (roots.length) this.onRoots([...new Set(roots)]);
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
  }
  stop() { this.observer?.disconnect(); this.observer = null; }
}
```

- [ ] **步骤 4：接入动态翻译与 AbortController**

为 `TranslationController` 增加 `add()`，把新增节点纳入同一个恢复集合；内容脚本启用时创建 `AbortController`，关闭时依次执行 `abort()`、`observer.stop()`、`controller.restore()`。

```ts
// TranslationController 新增方法
add(blocks: TextBlock[]) {
  for (const block of blocks) if (!this.byId.has(block.id)) this.byId.set(block.id, block);
}
```

```ts
const abortController = new AbortController();
async function translateRoots(roots: Node[]) {
  const blocks = roots.flatMap((root) => scanTextNodes(root));
  controller?.add(blocks);
  const queue = new ViewportQueue(blocks);
  while (queue.size > 0 && !abortController.signal.aborted) {
    const batch = queue.takeBatch(20);
    const results = await browser.runtime.sendMessage({ type: 'translation:blocks', blocks: batch.map(({ id, original: text }) => ({ id, text })) });
    if (abortController.signal.aborted) return;
    controller?.apply(results);
  }
}
const observer = new MutationTranslationController(document.body, (roots) => { void translateRoots(roots); });
observer.start();

function disable() {
  abortController.abort();
  observer.stop();
  controller?.restore();
  controller = null;
}
```

运行：`npm test -- tests/unit/webpage/mutation-controller.test.ts && npm run check`  
预期：动态节点测试和全量检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/webpage web-translate-plugin/entrypoints/webpage.content
git commit -m "feat: translate dynamic webpage content"
```

### 任务 6：设置页与浏览器端到端验收

**文件：**
- 创建：`web-translate-plugin/entrypoints/options/index.html`
- 创建：`web-translate-plugin/entrypoints/options/main.tsx`
- 创建：`web-translate-plugin/entrypoints/options/App.tsx`
- 创建：`web-translate-plugin/tests/e2e/webpage-translation.spec.ts`

**接口：**
- 产出：可保存、校验并测试连接的 Provider 设置页。
- 产出：普通网页 MVP 的端到端验收。

- [ ] **步骤 1：实现设置表单**

```tsx
import React from 'react';

export function App() {
  const [settings, setSettings] = React.useState(defaultSettings);
  React.useEffect(() => { void getSettings().then(setSettings); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings.openAi.baseUrl.startsWith('https://')) throw new Error('接口地址必须使用 HTTPS');
    if (!settings.openAi.apiKey || !settings.openAi.model) throw new Error('API Key 和模型不能为空');
    await saveSettings(settings);
  };
  return <form onSubmit={save}>
    <label>接口地址<input value={settings.openAi.baseUrl} onChange={(e) => setSettings({ ...settings, openAi: { ...settings.openAi, baseUrl: e.target.value } })} /></label>
    <label>模型<input value={settings.openAi.model} onChange={(e) => setSettings({ ...settings, openAi: { ...settings.openAi, model: e.target.value } })} /></label>
    <label>API Key<input type="password" value={settings.openAi.apiKey} onChange={(e) => setSettings({ ...settings, openAi: { ...settings.openAi, apiKey: e.target.value } })} /></label>
    <button type="submit">保存</button>
  </form>;
}
```

- [ ] **步骤 2：创建端到端测试页面和断言**

```ts
import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('原位替换并恢复且按钮事件不丢失', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  await context.route('https://article.example.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<main><p>Hello world</p><button id="action" onclick="window.clicked=(window.clicked||0)+1">Submit</button></main>' }));
  await context.route('https://api.example.test/v1/chat/completions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":"web-1","text":"你好，世界"},{"id":"web-2","text":"提交"}]}' } }] }) }));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(() => chrome.storage.local.set({ settings: { openAi: { baseUrl: 'https://api.example.test/v1', apiKey: 'test', model: 'test-model' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' } }));
  const page = await context.newPage();
  await page.goto('https://article.example.test/');
  const tabId = await options.evaluate(async () => (await chrome.tabs.query({ url: 'https://article.example.test/' }))[0].id!);
  await options.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['/content-scripts/webpage.js'] });
    await chrome.tabs.sendMessage(id, { type: 'webpage:enable' });
  }, tabId);
  await expect(page.locator('p')).toHaveText('你好，世界');
  await expect(page.locator('#action')).toHaveText('提交');
  await page.locator('#action').click();
  expect(await page.evaluate(() => (window as Window & { clicked: number }).clicked)).toBe(1);
  await options.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'webpage:disable' }), tabId);
  await expect(page.locator('p')).toHaveText('Hello world');
  await page.locator('#action').click();
  expect(await page.evaluate(() => (window as Window & { clicked: number }).clicked)).toBe(2);
  await context.close();
});
```

- [ ] **步骤 3：人工验收动态网站**

在一个静态英文页面和一个无限滚动页面分别验证：启用、首屏优先、继续滚动、悬停原文、关闭恢复、链接和按钮仍可用。敏感页面显示不可启用提示。

- [ ] **步骤 4：运行全部检查**

运行：`npm run check`  
预期：类型检查、全部单元测试和构建通过。  
运行：`npm run test:e2e -- webpage-translation.spec.ts`  
预期：端到端用例通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin
git commit -m "feat: complete webpage translation mvp"
```
