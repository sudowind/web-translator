# PDF 原 URL 接管技术探针实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施；所有步骤使用复选框跟踪。

**目标：** 从零搭建 Chrome MV3 插件骨架，并验证所有必需 PDF 类型能否在地址栏 URL 逐字不变的前提下由 PDF.js 接管。

**架构：** 使用 WXT、React 和 TypeScript 建立最小扩展，通过 Service Worker 调用 `chrome.scripting`，在当前 PDF 标签页执行可观测的接管探针。探针只验证注入、PDF 字节读取、URL/历史语义和恢复能力，不提前实现翻译产品；任一必需类型失败即停止后续 PDF 计划。

**技术栈：** Node.js 20+、npm、WXT、React、TypeScript、Vitest、Playwright、Chrome Manifest V3。

## 全局约束

- 所有 plan/spec 使用中文。
- 代码位于 `web-translate-plugin`。
- Chrome 最低版本设为 120。
- 启用 PDF 翻译后必须重渲染，不能用 Chrome 原生 PDF 查看器降级。
- 地址栏 URL 必须与启用前逐字一致，包括查询参数和 Fragment。
- 支持 arXiv、公开网络 PDF、重定向 PDF、依赖 Cookie 的 PDF 和本地 `file://` PDF。
- Phase 0 未全部通过前，不开始 PDF 产品功能。

---

## 文件结构

```text
web-translate-plugin/
├─ entrypoints/
│  ├─ background.ts                 # 注册消息处理器并执行接管探针
│  └─ popup/
│     ├─ index.html                 # 探针控制页入口
│     ├─ main.tsx                   # React 挂载
│     └─ App.tsx                    # 运行/恢复探针及展示报告
├─ src/
│  └─ pdf-takeover/
│     ├─ contracts.ts               # 探针输入、结果、失败原因
│     ├─ detect-pdf.ts              # PDF 目标识别
│     ├─ takeover-dom.ts             # 标签页内最小接管与恢复
│     ├─ fetch-pdf.ts               # 网络 PDF 字节读取
│     ├─ probe-runner.ts             # 探针编排与 URL 不变量校验
│     └─ report-store.ts             # chrome.storage.local 报告持久化
├─ tests/
│  ├─ unit/pdf-takeover/
│  │  ├─ detect-pdf.test.ts
│  │  ├─ probe-runner.test.ts
│  │  └─ report-store.test.ts
│  └─ e2e/pdf-takeover.spec.ts
├─ fixtures/
│  └─ probe.pdf                      # 本地最小 PDF 样本
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ playwright.config.ts
└─ wxt.config.ts
```

### 任务 1：建立可测试的 WXT 插件骨架

**文件：**
- 创建：`web-translate-plugin/package.json`
- 创建：`web-translate-plugin/wxt.config.ts`
- 创建：`web-translate-plugin/tsconfig.json`
- 创建：`web-translate-plugin/vitest.config.ts`
- 创建：`web-translate-plugin/playwright.config.ts`
- 创建：`web-translate-plugin/entrypoints/background.ts`
- 创建：`web-translate-plugin/entrypoints/popup/index.html`
- 创建：`web-translate-plugin/entrypoints/popup/main.tsx`
- 创建：`web-translate-plugin/entrypoints/popup/App.tsx`

**接口：**
- 产出：可构建、可加载、可执行 Vitest 的 Chrome MV3 插件。
- 后续依赖：所有其他任务都使用这里的 WXT 入口和测试配置。

- [ ] **步骤 1：创建包配置与测试脚本**

```json
{
  "name": "web-translate-plugin",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt -b chrome",
    "build": "wxt build -b chrome",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "check": "npm run typecheck && npm run test && npm run build",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "@wxt-dev/module-react": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@types/chrome": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vitest": "latest",
    "wxt": "latest"
  }
}
```

- [ ] **步骤 2：创建 WXT、TypeScript 和测试配置**

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Web Translate Probe',
    minimum_chrome_version: '120',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    action: { default_title: 'PDF 接管探针' },
  },
});
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { environment: 'jsdom', clearMocks: true },
});
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
});
```

- [ ] **步骤 3：创建最小入口**

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  console.info('PDF takeover probe ready');
});
```

```tsx
// entrypoints/popup/App.tsx
export function App() {
  return <main><h1>PDF 接管探针</h1></main>;
}
```

```tsx
// entrypoints/popup/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

```html
<!-- entrypoints/popup/index.html -->
<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF 接管探针</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

- [ ] **步骤 4：安装依赖并验证骨架**

运行：`cd web-translate-plugin && npm install`  
预期：依赖安装成功并执行 `wxt prepare`。  
运行：`npm run check`  
预期：类型检查、空测试集和 Chrome 构建全部成功，产物位于 `.output/chrome-mv3`。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin
git commit -m "build: scaffold chrome extension probe"
```

### 任务 2：定义 PDF 识别与探针结果契约

**文件：**
- 创建：`web-translate-plugin/src/pdf-takeover/contracts.ts`
- 创建：`web-translate-plugin/src/pdf-takeover/detect-pdf.ts`
- 创建：`web-translate-plugin/tests/unit/pdf-takeover/detect-pdf.test.ts`

**接口：**
- 产出：`classifyPdfTarget(input: PdfDetectionInput): PdfTargetKind | null`。
- 产出：`TakeoverProbeResult`，供探针编排、存储和 UI 共用。

- [ ] **步骤 1：先写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { classifyPdfTarget } from '../../../src/pdf-takeover/detect-pdf';

describe('classifyPdfTarget', () => {
  it.each([
    ['https://arxiv.org/pdf/2401.00001', 'application/pdf', 'arxiv'],
    ['https://example.com/paper.pdf?download=1#page=2', 'application/pdf', 'remote'],
    ['file:///C:/papers/test.pdf', 'application/pdf', 'local'],
  ] as const)('识别 %s', (url, contentType, expected) => {
    expect(classifyPdfTarget({ url, contentType })).toBe(expected);
  });

  it('拒绝普通网页', () => {
    expect(classifyPdfTarget({ url: 'https://example.com', contentType: 'text/html' })).toBeNull();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/pdf-takeover/detect-pdf.test.ts`  
预期：失败，提示无法解析 `detect-pdf` 模块。

- [ ] **步骤 3：实现契约与识别逻辑**

```ts
// src/pdf-takeover/contracts.ts
export type PdfTargetKind = 'arxiv' | 'remote' | 'authenticated' | 'local';
export type ProbeFailureCode =
  | 'not_pdf'
  | 'permission_denied'
  | 'script_injection_blocked'
  | 'url_changed'
  | 'bytes_unreadable'
  | 'restore_failed';

export interface PdfDetectionInput { url: string; contentType?: string }
export interface TakeoverProbeResult {
  tabId: number;
  originalUrl: string;
  finalUrl: string;
  kind: PdfTargetKind;
  injected: boolean;
  bytesReadable: boolean;
  restored: boolean;
  passed: boolean;
  failure?: ProbeFailureCode;
  detail?: string;
  measuredAt: string;
}
```

```ts
// src/pdf-takeover/detect-pdf.ts
import type { PdfDetectionInput, PdfTargetKind } from './contracts';

export function classifyPdfTarget(input: PdfDetectionInput): PdfTargetKind | null {
  const url = new URL(input.url);
  const pdfByType = input.contentType?.toLowerCase().includes('application/pdf') ?? false;
  const pdfByPath = /\.pdf$/i.test(url.pathname) || url.hostname === 'arxiv.org' && url.pathname.startsWith('/pdf/');
  if (!pdfByType && !pdfByPath) return null;
  if (url.protocol === 'file:') return 'local';
  if (url.hostname === 'arxiv.org' && url.pathname.startsWith('/pdf/')) return 'arxiv';
  return 'remote';
}
```

- [ ] **步骤 4：运行测试并检查类型**

运行：`npm test -- tests/unit/pdf-takeover/detect-pdf.test.ts && npm run typecheck`  
预期：4 个用例通过，类型检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/pdf-takeover web-translate-plugin/tests/unit/pdf-takeover
git commit -m "test: define pdf takeover probe contracts"
```

### 任务 3：实现 URL 不变量校验与最小 DOM 接管

**文件：**
- 创建：`web-translate-plugin/src/pdf-takeover/takeover-dom.ts`
- 创建：`web-translate-plugin/src/pdf-takeover/probe-runner.ts`
- 创建：`web-translate-plugin/tests/unit/pdf-takeover/probe-runner.test.ts`

**接口：**
- 产出：`runTakeoverProbe(deps, tab): Promise<TakeoverProbeResult>`。
- 产出：`mountProbeSurface()` 与 `restoreProbeSurface()`，只能在目标标签页执行。

- [ ] **步骤 1：先写 URL 改变与注入失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { runTakeoverProbe } from '../../../src/pdf-takeover/probe-runner';

const tab = { id: 7, url: 'https://example.com/paper.pdf?x=1#page=2' };

describe('runTakeoverProbe', () => {
  it('URL 发生任何变化即失败', async () => {
    const result = await runTakeoverProbe({
      classify: () => 'remote',
      mount: vi.fn().mockResolvedValue({ href: 'https://example.com/paper.pdf?x=1', injected: true }),
      readBytes: vi.fn().mockResolvedValue(true),
      restore: vi.fn().mockResolvedValue(true),
    }, tab);
    expect(result).toMatchObject({ passed: false, failure: 'url_changed' });
  });

  it('全部条件成立才通过', async () => {
    const result = await runTakeoverProbe({
      classify: () => 'remote',
      mount: vi.fn().mockResolvedValue({ href: tab.url, injected: true }),
      readBytes: vi.fn().mockResolvedValue(true),
      restore: vi.fn().mockResolvedValue(true),
    }, tab);
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/pdf-takeover/probe-runner.test.ts`  
预期：失败，提示 `probe-runner` 不存在。

- [ ] **步骤 3：实现最小编排与页面接管函数**

```ts
// src/pdf-takeover/probe-runner.ts
import type { PdfTargetKind, TakeoverProbeResult } from './contracts';

interface TabInput { id: number; url: string }
interface ProbeDeps {
  classify(url: string): PdfTargetKind | null;
  mount(tabId: number): Promise<{ href: string; injected: boolean }>;
  readBytes(url: string): Promise<boolean>;
  restore(tabId: number): Promise<boolean>;
}

export async function runTakeoverProbe(deps: ProbeDeps, tab: TabInput): Promise<TakeoverProbeResult> {
  const kind = deps.classify(tab.url);
  const base = { tabId: tab.id, originalUrl: tab.url, finalUrl: tab.url, kind: kind ?? 'remote', injected: false, bytesReadable: false, restored: false, passed: false, measuredAt: new Date().toISOString() } as TakeoverProbeResult;
  if (!kind) return { ...base, failure: 'not_pdf' };
  try {
    const mounted = await deps.mount(tab.id);
    base.injected = mounted.injected;
    base.finalUrl = mounted.href;
    if (mounted.href !== tab.url) return { ...base, failure: 'url_changed' };
    base.bytesReadable = await deps.readBytes(tab.url);
    base.restored = await deps.restore(tab.id);
    base.passed = mounted.injected && base.bytesReadable && base.restored;
    if (!base.bytesReadable) base.failure = 'bytes_unreadable';
    else if (!base.restored) base.failure = 'restore_failed';
    return base;
  } catch (error) {
    return { ...base, failure: 'script_injection_blocked', detail: String(error) };
  }
}
```

```ts
// src/pdf-takeover/takeover-dom.ts
export function mountProbeSurface() {
  const previous = document.documentElement.innerHTML;
  sessionStorage.setItem('web-translate:probe:previous', previous);
  document.documentElement.innerHTML = '<head><title>PDF 接管探针</title></head><body><main id="web-translate-probe-root" data-renderer="pdfjs-probe">PDF.js 接管测试界面</main></body>';
  return { href: location.href, injected: document.getElementById('web-translate-probe-root') !== null };
}

export function restoreProbeSurface() {
  const previous = sessionStorage.getItem('web-translate:probe:previous');
  if (previous === null) return false;
  document.documentElement.innerHTML = previous;
  sessionStorage.removeItem('web-translate:probe:previous');
  return true;
}
```

- [ ] **步骤 4：运行单测**

运行：`npm test -- tests/unit/pdf-takeover/probe-runner.test.ts`  
预期：2 个用例通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/pdf-takeover web-translate-plugin/tests/unit/pdf-takeover/probe-runner.test.ts
git commit -m "feat: add url invariant takeover probe"
```

### 任务 4：接入真实 Chrome API、PDF 字节读取与报告存储

**文件：**
- 创建：`web-translate-plugin/src/pdf-takeover/fetch-pdf.ts`
- 创建：`web-translate-plugin/src/pdf-takeover/report-store.ts`
- 创建：`web-translate-plugin/tests/unit/pdf-takeover/report-store.test.ts`
- 修改：`web-translate-plugin/entrypoints/background.ts`
- 修改：`web-translate-plugin/entrypoints/popup/App.tsx`

**接口：**
- 产出：消息 `pdf-probe:run`、`pdf-probe:restore`、`pdf-probe:latest`。
- 产出：`readPdfBytes(url): Promise<boolean>`。
- 产出：`saveProbeResult(result)` 与 `getLatestProbeResult()`。

- [ ] **步骤 1：先写报告存储测试**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getLatestProbeResult, saveProbeResult } from '../../../src/pdf-takeover/report-store';

describe('probe report store', () => {
  beforeEach(() => fakeBrowser.reset());
  it('保存并读取最近结果', async () => {
    const result = { tabId: 1, originalUrl: 'https://x/p.pdf', finalUrl: 'https://x/p.pdf', kind: 'remote', injected: true, bytesReadable: true, restored: true, passed: true, measuredAt: '2026-07-11T00:00:00.000Z' } as const;
    await saveProbeResult(result);
    expect(await getLatestProbeResult()).toEqual(result);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/pdf-takeover/report-store.test.ts`  
预期：失败，提示报告存储模块不存在。

- [ ] **步骤 3：实现字节读取、存储和消息处理**

```ts
// src/pdf-takeover/fetch-pdf.ts
export async function readPdfBytes(url: string): Promise<boolean> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) return false;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 4 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
}
```

```ts
// src/pdf-takeover/report-store.ts
import { storage } from 'wxt/utils/storage';
import type { TakeoverProbeResult } from './contracts';

const latest = storage.defineItem<TakeoverProbeResult | null>('local:pdf-probe-latest', { fallback: null });
export const saveProbeResult = (result: TakeoverProbeResult) => latest.setValue(result);
export const getLatestProbeResult = () => latest.getValue();
```

```ts
// entrypoints/background.ts 的核心逻辑
import { classifyPdfTarget } from '../src/pdf-takeover/detect-pdf';
import { readPdfBytes } from '../src/pdf-takeover/fetch-pdf';
import { runTakeoverProbe } from '../src/pdf-takeover/probe-runner';
import { saveProbeResult } from '../src/pdf-takeover/report-store';
import { mountProbeSurface, restoreProbeSurface } from '../src/pdf-takeover/takeover-dom';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (message) => {
    if (message?.type !== 'pdf-probe:run') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined || tab.url === undefined) throw new Error('缺少活动标签页');
    const result = await runTakeoverProbe({
      classify: (url) => classifyPdfTarget({ url, contentType: 'application/pdf' }),
      mount: async (tabId) => (await browser.scripting.executeScript({ target: { tabId }, func: mountProbeSurface }))[0].result!,
      readBytes: readPdfBytes,
      restore: async (tabId) => Boolean((await browser.scripting.executeScript({ target: { tabId }, func: restoreProbeSurface }))[0].result),
    }, { id: tab.id, url: tab.url });
    await saveProbeResult(result);
    return result;
  });
});
```

- [ ] **步骤 4：在 Popup 中提供运行按钮并验证**

```tsx
import React from 'react';

export function App() {
  const [result, setResult] = React.useState<TakeoverProbeResult | null>(null);
  const run = async () => setResult(await browser.runtime.sendMessage({ type: 'pdf-probe:run' }));
  return <main><h1>PDF 接管探针</h1><button onClick={run}>运行探针</button><pre>{result ? JSON.stringify(result, null, 2) : '尚未运行'}</pre></main>;
}
```

运行：`npm run check`  
预期：单元测试、类型检查与构建全部通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin
git commit -m "feat: wire chrome pdf takeover probe"
```

### 任务 5：执行 Go/No-Go 验收矩阵并记录结论

**文件：**
- 创建：`web-translate-plugin/fixtures/probe.pdf`
- 创建：`web-translate-plugin/tests/e2e/pdf-takeover.spec.ts`
- 创建：`docs/superpowers/specs/2026-07-11-pdf-takeover-probe-results.md`

**接口：**
- 产出：包含每类 PDF 的原 URL、最终 URL、注入、字节读取、恢复和结论的正式报告。
- 后续依赖：只有报告总结果为 `GO` 时，才能执行 PDF 产品计划。

- [ ] **步骤 1：创建自动化 URL 断言**

```ts
import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('地址栏 URL 必须逐字不变', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const original = 'https://arxiv.org/pdf/2401.00001#page=2';
  await page.goto(original);
  const before = page.url();
  expect(before).toBe(original);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  const result = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'pdf-probe:run' }));
  const after = page.url();
  expect(after).toBe(before);
  expect(result).toMatchObject({ originalUrl: original, finalUrl: original });
  await context.close();
});
```

- [ ] **步骤 2：构建并加载未打包扩展**

运行：`npm run build`  
预期：`.output/chrome-mv3/manifest.json` 存在。  
在 Chrome `chrome://extensions` 中开启开发者模式并加载 `.output/chrome-mv3`，为本地文件测试开启“允许访问文件网址”。

- [ ] **步骤 3：逐项执行矩阵**

对以下每项记录启用前 URL、启用后 URL、刷新后 URL、是否出现 `data-renderer="pdfjs-probe"`、PDF 头是否可读、是否成功恢复：

```text
1. https://arxiv.org/pdf/2401.00001
2. 一个公开 HTTPS 直链 PDF
3. 一个包含 query、fragment 和重定向的 PDF
4. 一个依赖当前 Chrome Cookie 的 PDF
5. file:///.../web-translate-plugin/fixtures/probe.pdf
```

- [ ] **步骤 4：写入结果与硬结论**

```markdown
# PDF 接管技术探针结果

日期：2026-07-11
结论：GO 或 NO-GO

| 类型 | 原 URL=最终 URL | PDF.js 测试界面 | 字节可读 | 可恢复 | 结果 |
|---|---:|---:|---:|---:|---:|
| arXiv | 是/否 | 是/否 | 是/否 | 是/否 | 通过/失败 |

## 决策

只有全部行通过时填写 `GO`；任何一行失败时填写 `NO-GO`，停止 PDF 产品计划并回到设计约束讨论。
```

运行：`npm run check`  
预期：所有自动检查通过；人工矩阵报告不存在空白项。

- [ ] **步骤 5：提交探针结论**

```bash
git add web-translate-plugin docs/superpowers/specs/2026-07-11-pdf-takeover-probe-results.md
git commit -m "docs: record pdf takeover go no-go result"
```
