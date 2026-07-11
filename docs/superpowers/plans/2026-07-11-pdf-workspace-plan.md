# PDF 双栏翻译与智能体工作台实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施；所有步骤使用复选框跟踪。

**目标：** 在 PDF 接管探针全部通过后，实现原 URL 不变、PDF.js 重渲染、MinerU 逐页解析翻译和整篇论文问答的 Chrome 插件 MVP。

**架构：** 把探针验证通过的接管代码提升为正式 `PdfTakeoverPort`，在当前标签页挂载 React 工作台。PDF.js 直接消费 PDF 字节并渲染左栏；MinerU 输出规范化为 `DocumentModel`，翻译调度器按当前页优先生成右栏译文；智能体上下文构建器基于整篇文档、当前页和选中文本发起问答。

**技术栈：** WXT、React、TypeScript、PDF.js、IndexedDB（`idb`）、OpenAI 兼容 Chat Completions、MinerU API、Vitest、Playwright、KaTeX。

## 全局约束

- 只有 PDF 探针报告结论为 `GO` 时才能执行本计划。
- 所有 plan/spec 使用中文。
- 所有启用翻译的 PDF 必须由 PDF.js 重渲染，不能降级到原生查看器。
- 地址栏 URL 必须逐字不变，包括查询参数和 Fragment。
- PDF.js 渲染不等待 MinerU；MinerU 失败时左栏仍可阅读。
- 译文严格按页组织，当前页优先。
- 智能体首版使用整篇解析结果，不实现向量检索。
- 用户确认前，不上传本地或依赖 Cookie 的 PDF。
- 任何 Provider 凭据都不能进入页面 DOM、日志或 Prompt。

---

## 文件结构

```text
web-translate-plugin/
├─ entrypoints/
│  ├─ background.ts
│  ├─ pdf-workspace.content/
│  │  ├─ index.tsx                         # 正式接管与工作台挂载
│  │  └─ style.css
│  └─ options/App.tsx                      # 增加 MinerU 设置
├─ src/
│  ├─ document/
│  │  ├─ model.ts
│  │  ├─ ids.ts
│  │  └─ normalize-mineru.ts
│  ├─ pdf/
│  │  ├─ takeover-port.ts
│  │  ├─ pdf-source.ts
│  │  ├─ PdfWorkspace.tsx
│  │  ├─ PdfViewer.tsx
│  │  ├─ TranslationPane.tsx
│  │  ├─ sync-controller.ts
│  │  └─ workspace-reducer.ts
│  ├─ providers/mineru/
│  │  ├─ contracts.ts
│  │  └─ client.ts
│  ├─ translation/
│  │  ├─ page-scheduler.ts
│  │  └─ translate-page.ts
│  ├─ agent/
│  │  ├─ context-builder.ts
│  │  ├─ client.ts
│  │  └─ AgentPanel.tsx
│  └─ storage/
│     ├─ db.ts
│     └─ repositories.ts
└─ tests/
   ├─ unit/document/normalize-mineru.test.ts
   ├─ unit/providers/mineru/client.test.ts
   ├─ unit/storage/repositories.test.ts
   ├─ unit/pdf/sync-controller.test.ts
   ├─ unit/translation/page-scheduler.test.ts
   ├─ unit/agent/context-builder.test.ts
   └─ e2e/pdf-workspace.spec.ts
```

### 任务 1：建立文档模型与 MinerU 规范化边界

**文件：**
- 创建：`web-translate-plugin/src/document/model.ts`
- 创建：`web-translate-plugin/src/document/ids.ts`
- 创建：`web-translate-plugin/src/document/normalize-mineru.ts`
- 创建：`web-translate-plugin/tests/unit/document/normalize-mineru.test.ts`
- 修改：`web-translate-plugin/package.json`

**接口：**
- 产出：`DocumentModel`、`DocumentPage`、`DocumentBlock`。
- 产出：`normalizeMineru(input, metadata): DocumentModel`。

- [ ] **步骤 1：安装 PDF 工作台依赖**

运行：`npm install pdfjs-dist idb fflate react-markdown remark-math rehype-katex katex`  
运行：`npm install -D @types/katex`  
预期：依赖写入 `package.json` 和锁文件，`npm run typecheck` 仍通过。

- [ ] **步骤 2：先写规范化失败测试**

```ts
import { expect, it } from 'vitest';
import { normalizeMineru } from '../../../src/document/normalize-mineru';

it('按 page_idx 保留标题、段落与公式', () => {
  const model = normalizeMineru([
    { page_idx: 0, type: 'title', text: 'A Paper' },
    { page_idx: 0, type: 'text', text: 'Introduction' },
    { page_idx: 1, type: 'equation', text: 'E=mc^2' },
  ], { sourceUrl: 'https://arxiv.org/pdf/x', hash: 'sha256:x', title: 'A Paper', pageCount: 2 });
  expect(model.pages[0].blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph']);
  expect(model.pages[1].blocks[0]).toMatchObject({ kind: 'formula', latex: 'E=mc^2' });
});
```

- [ ] **步骤 3：实现稳定模型与 ID**

```ts
// src/document/model.ts
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'formula' | 'table' | 'figure' | 'caption' | 'footnote' | 'other';
export interface DocumentBlock { id: string; pageId: string; order: number; kind: BlockKind; text: string; latex?: string; html?: string; resourceUrl?: string; polygon?: number[] }
export interface DocumentPage { id: string; index: number; blocks: DocumentBlock[] }
export interface DocumentModel { id: string; sourceUrl: string; hash: string; title: string; pageCount: number; pages: DocumentPage[] }
```

```ts
// src/document/ids.ts
export const pageId = (hash: string, index: number) => `${hash}:p${index + 1}`;
export const blockId = (hash: string, page: number, order: number) => `${hash}:p${page + 1}:b${order + 1}`;
```

```ts
// src/document/normalize-mineru.ts
import type { BlockKind, DocumentModel } from './model';
import { blockId, pageId } from './ids';

interface MineruBlock { page_idx: number; type: string; text?: string; img_path?: string; bbox?: number[] }
interface Metadata { sourceUrl: string; hash: string; title: string; pageCount: number }
const kinds: Record<string, BlockKind> = { title: 'heading', text: 'paragraph', list: 'list', equation: 'formula', table: 'table', image: 'figure', image_caption: 'caption', footnote: 'footnote' };

export function normalizeMineru(input: MineruBlock[], metadata: Metadata): DocumentModel {
  const pages = Array.from({ length: metadata.pageCount }, (_, index) => ({ id: pageId(metadata.hash, index), index, blocks: [] as DocumentModel['pages'][number]['blocks'] }));
  for (const raw of input) {
    const page = pages[raw.page_idx];
    if (!page) throw new Error(`MINERU_PAGE_OUT_OF_RANGE_${raw.page_idx}`);
    const order = page.blocks.length;
    const kind = kinds[raw.type] ?? 'other';
    page.blocks.push({ id: blockId(metadata.hash, raw.page_idx, order), pageId: page.id, order, kind, text: raw.text ?? '', latex: kind === 'formula' ? raw.text : undefined, resourceUrl: raw.img_path, polygon: raw.bbox });
  }
  return { id: metadata.hash, ...metadata, pages };
}
```

- [ ] **步骤 4：运行测试**

运行：`npm test -- tests/unit/document/normalize-mineru.test.ts && npm run typecheck`  
预期：规范化测试和类型检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin
git commit -m "feat: normalize mineru document model"
```

### 任务 2：实现 MinerU 异步任务 Provider

**文件：**
- 创建：`web-translate-plugin/src/providers/mineru/contracts.ts`
- 创建：`web-translate-plugin/src/providers/mineru/client.ts`
- 创建：`web-translate-plugin/src/providers/mineru/result-loader.ts`
- 创建：`web-translate-plugin/tests/unit/providers/mineru/client.test.ts`
- 创建：`web-translate-plugin/tests/unit/providers/mineru/result-loader.test.ts`
- 修改：`web-translate-plugin/src/settings/schema.ts`
- 修改：`web-translate-plugin/entrypoints/options/App.tsx`

**接口：**
- 产出：`MineruClient.createUrlTask()`、`createUploadTask()`、`waitForResult()`。
- 产出：`loadMineruResult(zipUrl, metadata)`，从结果 Zip 中读取 `_content_list.json` 并生成 `DocumentModel`。
- 产出：任务状态 `pending | running | done | failed`。

- [ ] **步骤 1：先写 URL 任务与轮询测试**

```ts
import { expect, it, vi } from 'vitest';
import { MineruClient } from '../../../src/providers/mineru/client';

it('创建 URL 任务并轮询完成', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: 't1' } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { state: 'done', full_zip_url: 'https://cdn/result.zip' } }), { status: 200 }));
  const client = new MineruClient({ token: 'token', baseUrl: 'https://mineru.net' }, fetcher, async () => undefined);
  const taskId = await client.createUrlTask('https://example.com/a.pdf');
  await expect(client.waitForResult(taskId)).resolves.toMatchObject({ state: 'done' });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/providers/mineru/client.test.ts`  
预期：失败，提示 MinerU 客户端不存在。

- [ ] **步骤 3：实现客户端与有限轮询**

```ts
// src/providers/mineru/contracts.ts
export interface MineruSettings { baseUrl: string; token: string; modelVersion: 'vlm' | 'pipeline' }
export interface MineruTaskResult { state: 'pending' | 'running' | 'done' | 'failed'; fullZipUrl?: string; error?: string }
```

```ts
// src/providers/mineru/client.ts
import type { MineruSettings, MineruTaskResult } from './contracts';

export class MineruClient {
  constructor(private readonly settings: MineruSettings, private readonly fetcher: typeof fetch = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}
  private headers() { return { authorization: `Bearer ${this.settings.token}`, 'content-type': 'application/json' }; }
  async createUrlTask(url: string) {
    const response = await this.fetcher(`${this.settings.baseUrl}/api/v4/extract/task`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ url, model_version: this.settings.modelVersion }) });
    if (!response.ok) throw new Error(`MINERU_HTTP_${response.status}`);
    const body = await response.json();
    if (body.code !== 0 || !body.data?.task_id) throw new Error(`MINERU_CREATE_${body.code}`);
    return body.data.task_id as string;
  }
  async createUploadTask(fileName: string, bytes: ArrayBuffer) {
    const init = await this.fetcher(`${this.settings.baseUrl}/api/v4/file-urls/batch`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ files: [{ name: fileName, data_id: crypto.randomUUID() }], model_version: this.settings.modelVersion }) });
    if (!init.ok) throw new Error(`MINERU_UPLOAD_INIT_${init.status}`);
    const body = await init.json();
    const uploadUrl = body.data?.file_urls?.[0];
    const batchId = body.data?.batch_id;
    if (!uploadUrl || !batchId) throw new Error('MINERU_UPLOAD_URL_MISSING');
    const uploaded = await this.fetcher(uploadUrl, { method: 'PUT', body: bytes });
    if (!uploaded.ok) throw new Error(`MINERU_UPLOAD_${uploaded.status}`);
    return batchId as string;
  }
  async waitForResult(taskId: string, signal?: AbortSignal): Promise<MineruTaskResult> {
    for (let attempt = 0; attempt < 120; attempt++) {
      signal?.throwIfAborted();
      const response = await this.fetcher(`${this.settings.baseUrl}/api/v4/extract/task/${taskId}`, { headers: this.headers(), signal });
      if (!response.ok) throw new Error(`MINERU_POLL_${response.status}`);
      const body = await response.json();
      const state = body.data?.state as string;
      if (state === 'done') return { state: 'done', fullZipUrl: body.data.full_zip_url };
      if (state === 'failed') return { state: 'failed', error: body.data.err_msg ?? '解析失败' };
      await this.sleep(Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)));
    }
    throw new Error('MINERU_TIMEOUT');
  }
}
```

- [ ] **步骤 4：实现结果 Zip 加载，并在设置页增加 MinerU 配置**

```ts
// src/providers/mineru/result-loader.ts
import { strFromU8, unzipSync } from 'fflate';
import { normalizeMineru } from '../../document/normalize-mineru';

export async function loadMineruResult(zipUrl: string, metadata: { sourceUrl: string; hash: string; title: string; pageCount: number }, fetcher: typeof fetch = fetch) {
  const response = await fetcher(zipUrl);
  if (!response.ok) throw new Error(`MINERU_RESULT_${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entry = Object.entries(files).find(([name]) => name.endsWith('_content_list.json'));
  if (!entry) throw new Error('MINERU_CONTENT_LIST_MISSING');
  const blocks = JSON.parse(strFromU8(entry[1]));
  if (!Array.isArray(blocks)) throw new Error('MINERU_CONTENT_LIST_INVALID');
  return normalizeMineru(blocks, metadata);
}
```

```ts
// tests/unit/providers/mineru/result-loader.test.ts
import { strToU8, zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { loadMineruResult } from '../../../src/providers/mineru/result-loader';

it('从 Zip 内容列表生成文档模型', async () => {
  const zip = zipSync({ 'paper_content_list.json': strToU8(JSON.stringify([{ page_idx: 0, type: 'text', text: 'Hello' }])) });
  const fetcher = vi.fn().mockResolvedValue(new Response(zip, { status: 200 }));
  const model = await loadMineruResult('https://cdn/result.zip', { sourceUrl: 'https://x/p.pdf', hash: 'sha256:x', title: 'P', pageCount: 1 }, fetcher);
  expect(model.pages[0].blocks[0].text).toBe('Hello');
});

it('缺少内容列表时拒绝结果', async () => {
  const zip = zipSync({ 'readme.txt': strToU8('empty') });
  const fetcher = vi.fn().mockResolvedValue(new Response(zip, { status: 200 }));
  await expect(loadMineruResult('https://cdn/result.zip', { sourceUrl: 'https://x/p.pdf', hash: 'sha256:x', title: 'P', pageCount: 1 }, fetcher)).rejects.toThrow('MINERU_CONTENT_LIST_MISSING');
});
```

```ts
export interface ExtensionSettings {
  openAi: OpenAiSettings;
  mineru: MineruSettings;
  sourceLanguage: string;
  targetLanguage: string;
}
```

运行：`npm test -- tests/unit/providers/mineru/client.test.ts tests/unit/providers/mineru/result-loader.test.ts && npm run typecheck`  
预期：Provider、结果加载测试和类型检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/providers/mineru web-translate-plugin/src/settings web-translate-plugin/entrypoints/options web-translate-plugin/tests/unit/providers/mineru
git commit -m "feat: add mineru async provider"
```

### 任务 3：实现 IndexedDB 文档、译文与任务仓储

**文件：**
- 创建：`web-translate-plugin/src/storage/db.ts`
- 创建：`web-translate-plugin/src/storage/repositories.ts`
- 创建：`web-translate-plugin/tests/unit/storage/repositories.test.ts`

**接口：**
- 产出：`documentRepository`、`translationRepository`、`taskRepository`。
- 缓存键包含内容哈希、语言、Provider、模型和 Schema 版本。

- [ ] **步骤 1：先写缓存隔离测试**

```ts
import { expect, it } from 'vitest';
import { translationCacheKey } from '../../../src/storage/repositories';

it('模型或 schema 变化会生成不同缓存键', () => {
  const base = { hash: 'h', page: 1, source: 'en', target: 'zh-CN', provider: 'openai', model: 'm1', schema: 1 };
  expect(translationCacheKey(base)).not.toBe(translationCacheKey({ ...base, model: 'm2' }));
  expect(translationCacheKey(base)).not.toBe(translationCacheKey({ ...base, schema: 2 }));
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/storage/repositories.test.ts`  
预期：失败，提示仓储模块不存在。

- [ ] **步骤 3：实现数据库与缓存键**

```ts
// src/storage/db.ts
import { openDB } from 'idb';
export const dbPromise = openDB('web-translate', 1, {
  upgrade(db) {
    db.createObjectStore('documents', { keyPath: 'id' });
    db.createObjectStore('translations', { keyPath: 'id' });
    db.createObjectStore('tasks', { keyPath: 'id' });
    db.createObjectStore('reading', { keyPath: 'id' });
  },
});
```

```ts
// src/storage/repositories.ts
import type { DocumentModel } from '../document/model';
import { dbPromise } from './db';
interface TranslationKey { hash: string; page: number; source: string; target: string; provider: string; model: string; schema: number }
export interface StoredTask { id: string; type: 'mineru'; status: 'parsing' | 'done' | 'failed'; sourceUrl: string; hash: string; title: string; pageCount: number }
export const translationCacheKey = (key: TranslationKey) => [key.hash, key.page, key.source, key.target, key.provider, key.model, key.schema].join('|');
export const documentRepository = {
  async get(id: string) { return (await dbPromise).get('documents', id) as Promise<DocumentModel | undefined>; },
  async put(model: DocumentModel) { await (await dbPromise).put('documents', model); },
  async delete(id: string) { await (await dbPromise).delete('documents', id); },
};
export const translationRepository = {
  async get(key: TranslationKey) { return (await dbPromise).get('translations', translationCacheKey(key)); },
  async put(key: TranslationKey, blocks: unknown) { await (await dbPromise).put('translations', { id: translationCacheKey(key), blocks }); },
  async deleteByHash(hash: string) {
    const db = await dbPromise;
    const tx = db.transaction('translations', 'readwrite');
    for (const item of await tx.store.getAll()) if (item.id.startsWith(`${hash}|`)) await tx.store.delete(item.id);
    await tx.done;
  },
};
export const taskRepository = {
  async put(task: StoredTask) { await (await dbPromise).put('tasks', task); },
  async get(id: string) { return (await dbPromise).get('tasks', id) as Promise<StoredTask | undefined>; },
  async listByStatus(status: StoredTask['status']) { return (await (await dbPromise).getAll('tasks') as StoredTask[]).filter((task) => task.status === status); },
};
export async function clearDocumentCache(hash: string) {
  const db = await dbPromise;
  await documentRepository.delete(hash);
  await translationRepository.deleteByHash(hash);
  const tx = db.transaction(['tasks', 'reading'], 'readwrite');
  for (const storeName of ['tasks', 'reading'] as const) {
    const store = tx.objectStore(storeName);
    for (const item of await store.getAll()) if (item.id === hash || item.hash === hash) await store.delete(item.id);
  }
  await tx.done;
}
export async function clearAllCache() {
  const db = await dbPromise;
  const tx = db.transaction(['documents', 'translations', 'tasks', 'reading'], 'readwrite');
  await Promise.all(['documents', 'translations', 'tasks', 'reading'].map((name) => tx.objectStore(name).clear()));
  await tx.done;
}
```

- [ ] **步骤 4：运行测试**

运行：`npm test -- tests/unit/storage/repositories.test.ts && npm run typecheck`  
预期：缓存键测试与类型检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/storage web-translate-plugin/tests/unit/storage
git commit -m "feat: cache pdf documents and translations"
```

### 任务 4：把通过探针的接管实现升级为 PDF.js 工作台

**文件：**
- 创建：`web-translate-plugin/src/pdf/takeover-port.ts`
- 创建：`web-translate-plugin/src/pdf/pdf-source.ts`
- 创建：`web-translate-plugin/src/pdf/workspace-reducer.ts`
- 创建：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 创建：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 创建：`web-translate-plugin/entrypoints/pdf-workspace.content/index.tsx`
- 创建：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改：`web-translate-plugin/entrypoints/background.ts`

**接口：**
- 消费：探针已验证的 `mountProbeSurface` 机制。
- 产出：`PdfTakeoverPort.mount(tabId)`、`restore(tabId)`。
- 产出：`loadPdfSource(url): Promise<Uint8Array>`。

- [ ] **步骤 1：定义正式接管端口和工作台状态**

```ts
// src/pdf/takeover-port.ts
export interface PdfTakeoverPort {
  mount(tabId: number): Promise<{ originalUrl: string }>;
  restore(tabId: number): Promise<{ restored: boolean; url: string }>;
}

export class ChromePdfTakeoverAdapter implements PdfTakeoverPort {
  async mount(tabId: number) {
    const before = await browser.tabs.get(tabId);
    if (!before.url) throw new Error('PDF_URL_MISSING');
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/pdf-workspace.js'] });
    const after = await browser.tabs.get(tabId);
    if (after.url !== before.url) throw new Error('PDF_URL_CHANGED');
    return { originalUrl: before.url };
  }
  async restore(tabId: number) {
    const before = await browser.tabs.get(tabId);
    if (!before.url) throw new Error('PDF_URL_MISSING');
    await browser.tabs.reload(tabId);
    const after = await browser.tabs.get(tabId);
    return { restored: after.url === before.url, url: after.url ?? '' };
  }
}
```

```ts
// src/pdf/workspace-reducer.ts
export interface WorkspaceState { sourceUrl: string; pageCount: number; activePage: number; scale: number; agentOpen: boolean; parseStatus: 'idle' | 'running' | 'done' | 'failed' }
export type WorkspaceAction = { type: 'page'; page: number } | { type: 'scale'; scale: number } | { type: 'agent'; open: boolean } | { type: 'parse'; status: WorkspaceState['parseStatus'] };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  if (action.type === 'page') return { ...state, activePage: action.page };
  if (action.type === 'scale') return { ...state, scale: Math.min(3, Math.max(.5, action.scale)) };
  if (action.type === 'agent') return { ...state, agentOpen: action.open };
  return { ...state, parseStatus: action.status };
}
```

- [ ] **步骤 2：实现 PDF 字节读取与哈希**

```ts
// src/pdf/pdf-source.ts
export async function loadPdfSource(url: string): Promise<{ bytes: Uint8Array; hash: string }> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`PDF_FETCH_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('PDF_SIGNATURE_INVALID');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { bytes, hash: `sha256:${hash}` };
}
```

- [ ] **步骤 3：实现 PDF.js 渲染组件**

```tsx
// src/pdf/PdfViewer.tsx
import React from 'react';
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export function PdfViewer({ bytes, scale, onPageVisible }: { bytes: Uint8Array; scale: number; onPageVisible(page: number): void }) {
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => entries.filter((entry) => entry.isIntersecting).forEach((entry) => onPageVisible(Number((entry.target as HTMLElement).dataset.pdfPage))), { threshold: .6 });
    void pdfjs.getDocument({ data: bytes }).promise.then(async (pdf) => {
      if (!root.current) return;
      root.current.replaceChildren();
      for (let index = 1; index <= pdf.numPages && !cancelled; index++) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.dataset.pdfPage = String(index);
        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        root.current.append(canvas);
        observer.observe(canvas);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] }).promise;
      }
    });
    return () => { cancelled = true; observer.disconnect(); };
  }, [bytes, scale, onPageVisible]);
  return <div className="pdf-pages" ref={root} />;
}
```

```tsx
// src/pdf/PdfWorkspace.tsx
import React from 'react';
import { loadPdfSource } from './pdf-source';
import { PdfViewer } from './PdfViewer';

export function PdfWorkspace({ sourceUrl }: { sourceUrl: string }) {
  const [source, setSource] = React.useState<{ bytes: Uint8Array; hash: string } | null>(null);
  const [activePage, setActivePage] = React.useState(1);
  const [scale, setScale] = React.useState(1.2);
  React.useEffect(() => { void loadPdfSource(sourceUrl).then(setSource); }, [sourceUrl]);
  if (!source) return <main data-renderer="pdfjs" role="status">正在读取 PDF…</main>;
  return <main data-renderer="pdfjs" className="pdf-workspace">
    <header><button onClick={() => setScale((value) => value - .1)}>缩小</button><span>第 {activePage} 页</span><button onClick={() => setScale((value) => value + .1)}>放大</button></header>
    <div className="pdf-column"><PdfViewer bytes={source.bytes} scale={scale} onPageVisible={setActivePage} /></div>
    <aside className="translation-column" aria-label="逐页译文">等待 MinerU 解析…</aside>
  </main>;
}
```

- [ ] **步骤 4：挂载工作台并接通启用/恢复消息**

```tsx
// entrypoints/pdf-workspace.content/index.tsx
import './style.css';
import { createRoot } from 'react-dom/client';
import { PdfWorkspace } from '../../src/pdf/PdfWorkspace';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', 'file:///*'], registration: 'runtime', runAt: 'document_start',
  async main() {
    const originalUrl = location.href;
    document.documentElement.innerHTML = '<head><title>PDF 翻译</title></head><body><div id="web-translate-pdf-root"></div></body>';
    if (location.href !== originalUrl) throw new Error('PDF_URL_CHANGED');
    createRoot(document.getElementById('web-translate-pdf-root')!).render(<PdfWorkspace sourceUrl={originalUrl} />);
  },
});
```

```ts
// entrypoints/background.ts 增加固定用途启用消息
browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'pdf:enable' && Number.isInteger(message.tabId)) {
    await browser.scripting.executeScript({ target: { tabId: message.tabId }, files: ['/content-scripts/pdf-workspace.js'] });
    return { enabled: true };
  }
  if (message?.type === 'pdf:disable' && Number.isInteger(message.tabId)) {
    return browser.tabs.reload(message.tabId).then(() => ({ enabled: false }));
  }
});
```

运行：`npm run check`  
预期：类型检查、单测和构建通过；人工打开探针矩阵中的任一 PDF 后，启用工作台能看到 PDF.js 画布且 URL 不变。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/pdf web-translate-plugin/entrypoints
git commit -m "feat: mount pdfjs translation workspace"
```

### 任务 5：实现逐页译文调度与左右同步

**文件：**
- 创建：`web-translate-plugin/src/translation/page-scheduler.ts`
- 创建：`web-translate-plugin/src/translation/translate-page.ts`
- 创建：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 创建：`web-translate-plugin/src/pdf/sync-controller.ts`
- 创建：`web-translate-plugin/tests/unit/translation/page-scheduler.test.ts`
- 创建：`web-translate-plugin/tests/unit/pdf/sync-controller.test.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`

**接口：**
- 产出：`PageScheduler.setActivePage(page)`、`take()`。
- 产出：`SyncController.onVisible(source, page)`、`suspend(source)`、`resync()`。

- [ ] **步骤 1：先写当前页优先测试**

```ts
import { expect, it } from 'vitest';
import { PageScheduler } from '../../../src/translation/page-scheduler';

it('当前页、相邻页、其余页依次出队', () => {
  const queue = new PageScheduler(6);
  queue.setActivePage(3);
  expect([queue.take(), queue.take(), queue.take()]).toEqual([3, 2, 4]);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/translation/page-scheduler.test.ts`  
预期：失败，提示调度器不存在。

- [ ] **步骤 3：实现调度器与逐页翻译**

```ts
// src/translation/page-scheduler.ts
export class PageScheduler {
  private active = 1;
  private done = new Set<number>();
  constructor(private readonly pageCount: number) {}
  setActivePage(page: number) { this.active = page; }
  markDone(page: number) { this.done.add(page); }
  take(): number | null {
    const ordered = [this.active, this.active - 1, this.active + 1, ...Array.from({ length: this.pageCount }, (_, i) => i + 1)];
    return ordered.find((page) => page >= 1 && page <= this.pageCount && !this.done.has(page)) ?? null;
  }
}
```

```ts
// src/translation/translate-page.ts
import type { DocumentPage } from '../document/model';
import type { OpenAiTranslationClient } from '../providers/openai/client';
export async function translatePage(client: OpenAiTranslationClient, page: DocumentPage, signal?: AbortSignal) {
  return client.translate({ sourceLanguage: 'en', targetLanguage: 'zh-CN', blocks: page.blocks.filter((block) => ['heading', 'paragraph', 'list', 'caption', 'footnote'].includes(block.kind)).map((block) => ({ id: block.id, text: block.text })) }, signal);
}
```

- [ ] **步骤 4：实现同步控制器和译文页锚点**

```ts
// src/pdf/sync-controller.ts
export type Pane = 'pdf' | 'translation';
export class SyncController {
  private suspended: Pane | null = null;
  constructor(private readonly navigate: (pane: Pane, page: number) => void) {}
  onVisible(source: Pane, page: number) {
    const target: Pane = source === 'pdf' ? 'translation' : 'pdf';
    if (this.suspended === target) return;
    this.navigate(target, page);
  }
  suspend(pane: Pane) { this.suspended = pane; }
  resync() { this.suspended = null; }
}
```

`TranslationPane` 为每页输出 `<section data-page="N">`，内容块按 `block.id` 渲染；公式与表格不发送翻译，只保留原始 LaTeX/HTML。运行：`npm run check`。  
预期：调度与同步测试、类型检查和构建通过。

```tsx
// src/pdf/TranslationPane.tsx
import React from 'react';
import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';

export function TranslationPane({ model, translations, onPageVisible }: { model: DocumentModel; translations: Map<string, TranslationResult>; onPageVisible(page: number): void }) {
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.filter((entry) => entry.isIntersecting).forEach((entry) => onPageVisible(Number((entry.target as HTMLElement).dataset.translationPage))), { threshold: .6 });
    root.current?.querySelectorAll('[data-translation-page]').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [model, onPageVisible]);
  return <div ref={root} className="translation-pages">{model.pages.map((page) => <section key={page.id} data-translation-page={page.index + 1} data-status={page.blocks.filter((block) => !['formula', 'table', 'figure'].includes(block.kind)).every((block) => translations.has(block.id)) ? 'done' : 'pending'}>
    <h2>第 {page.index + 1} 页</h2>
    {page.blocks.map((block) => <div key={block.id} data-block-id={block.id}>{block.kind === 'formula' ? <code>{block.latex}</code> : block.kind === 'table' ? <pre>{block.text}</pre> : translations.get(block.id)?.text ?? '翻译中…'}</div>)}
  </section>)}</div>;
}
```

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/translation web-translate-plugin/src/pdf web-translate-plugin/tests/unit
git commit -m "feat: translate and sync pdf pages"
```

### 任务 6：实现整篇上下文智能体与页码引用

**文件：**
- 创建：`web-translate-plugin/src/agent/context-builder.ts`
- 创建：`web-translate-plugin/src/agent/client.ts`
- 创建：`web-translate-plugin/src/agent/AgentPanel.tsx`
- 创建：`web-translate-plugin/tests/unit/agent/context-builder.test.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`

**接口：**
- 产出：`buildAgentContext(input): AgentContext`。
- 产出：`PaperAgentClient.ask(context, question, signal)`。
- 页码引用格式固定为 `[p:N]`。

- [ ] **步骤 1：先写完整上下文与压缩披露测试**

```ts
import { expect, it } from 'vitest';
import { buildAgentContext } from '../../../src/agent/context-builder';
import type { DocumentModel } from '../../../src/document/model';

const sampleDocument: DocumentModel = {
  id: 'sha256:x', sourceUrl: 'https://example.com/paper.pdf', hash: 'sha256:x', title: 'Paper', pageCount: 2,
  pages: [
    { id: 'sha256:x:p1', index: 0, blocks: [{ id: 'sha256:x:p1:b1', pageId: 'sha256:x:p1', order: 0, kind: 'heading', text: 'Introduction' }] },
    { id: 'sha256:x:p2', index: 1, blocks: [{ id: 'sha256:x:p2:b1', pageId: 'sha256:x:p2', order: 0, kind: 'paragraph', text: 'Main contribution' }] },
  ],
};

it('容量足够时包含整篇并保留页码', () => {
  const context = buildAgentContext({ model: sampleDocument, activePage: 2, selection: '', recentMessages: [], maxCharacters: 100_000 });
  expect(context.mode).toBe('full');
  expect(context.text).toContain('[p:1]');
  expect(context.text).toContain('[p:2]');
});

it('超限时明确进入 compressed 模式', () => {
  const context = buildAgentContext({ model: sampleDocument, activePage: 2, selection: '', recentMessages: [], maxCharacters: 100 });
  expect(context.mode).toBe('compressed');
  expect(context.notice).toContain('压缩上下文');
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/agent/context-builder.test.ts`  
预期：失败，提示上下文构建器不存在。

- [ ] **步骤 3：实现上下文构建器**

```ts
// src/agent/context-builder.ts
import type { DocumentModel } from '../document/model';
interface Input { model: DocumentModel; activePage: number; selection: string; recentMessages: { role: string; content: string }[]; maxCharacters: number }
export interface AgentContext { mode: 'full' | 'compressed'; text: string; notice?: string; recentMessages: Input['recentMessages'] }

export function buildAgentContext(input: Input): AgentContext {
  const pages = input.model.pages.map((page) => `[p:${page.index + 1}]\n${page.blocks.map((block) => block.text).join('\n')}`);
  const full = pages.join('\n\n');
  if (full.length <= input.maxCharacters) return { mode: 'full', text: full, recentMessages: input.recentMessages };
  const active = pages[input.activePage - 1] ?? '';
  const summaries = input.model.pages.map((page) => `[p:${page.index + 1}] ${page.blocks.filter((block) => block.kind === 'heading').map((block) => block.text).join('；') || page.blocks[0]?.text.slice(0, 120) || ''}`).join('\n');
  return { mode: 'compressed', text: `${summaries}\n\n当前页全文：\n${active}\n\n选中文本：${input.selection}`, notice: '论文超过模型上下文限制，已使用章节压缩上下文。', recentMessages: input.recentMessages };
}
```

- [ ] **步骤 4：实现客户端和可收起面板**

```ts
// src/agent/client.ts
import type { AgentContext } from './context-builder';

export interface OpenAiChatClient {
  complete(input: { system: string; context: string; messages: { role: string; content: string }[]; question: string }, signal?: AbortSignal): Promise<string>;
}

export class PaperAgentClient {
  constructor(private readonly client: OpenAiChatClient) {}
  async ask(context: AgentContext, question: string, signal?: AbortSignal) {
    return this.client.complete({ system: '根据论文回答。每个事实使用 [p:N] 引用，不得编造页码。', context: context.text, messages: context.recentMessages, question }, signal);
  }
}
```

`AgentPanel` 展示压缩提示、对话列表、输入框和停止按钮；解析回答中的 `/\[p:(\d+)\]/g` 为按钮，点击调用工作台统一 `navigateToPage(page)`。

```tsx
// src/agent/AgentPanel.tsx
import React from 'react';

export function AgentPanel({ notice, answer, onAsk, onNavigate, onClose }: { notice?: string; answer: string; onAsk(question: string): Promise<void>; onNavigate(page: number): void; onClose(): void }) {
  const [question, setQuestion] = React.useState('');
  const parts = answer.split(/(\[p:\d+\])/g);
  return <aside className="agent-panel">
    <header><strong>论文智能体</strong><button onClick={onClose}>收起</button></header>
    {notice && <p role="status">{notice}</p>}
    <div>{parts.map((part, index) => {
      const match = /^\[p:(\d+)\]$/.exec(part);
      return match ? <button key={index} onClick={() => onNavigate(Number(match[1]))}>第 {match[1]} 页</button> : <span key={index}>{part}</span>;
    })}</div>
    <form onSubmit={(event) => { event.preventDefault(); void onAsk(question); }}><label>向论文提问<textarea value={question} onChange={(event) => setQuestion(event.target.value)} /></label><button type="submit" disabled={!question.trim()}>发送</button></form>
  </aside>;
}
```

运行：`npm run check`。  
预期：上下文测试和全量检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin/src/agent web-translate-plugin/src/pdf web-translate-plugin/tests/unit/agent
git commit -m "feat: add whole-paper agent panel"
```

### 任务 7：实现任务恢复、错误状态和隐私确认

**文件：**
- 修改：`web-translate-plugin/entrypoints/background.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/src/providers/mineru/client.ts`
- 修改：`web-translate-plugin/src/storage/repositories.ts`
- 创建：`web-translate-plugin/tests/unit/pdf/workspace-reducer.test.ts`

**接口：**
- 产出：解析状态 `idle | awaiting-consent | uploading | parsing | translating | ready | failed`。
- 产出：重试当前页、重试失败页、取消、恢复任务和清除单篇缓存。

- [ ] **步骤 1：先写状态机测试**

```ts
import { expect, it } from 'vitest';
import { initialLifecycleState, lifecycleReducer } from '../../../src/pdf/workspace-reducer';

it('本地文件必须先确认再上传', () => {
  const state = lifecycleReducer(initialLifecycleState, { type: 'source-loaded', sourceKind: 'local' });
  expect(state.phase).toBe('awaiting-consent');
  expect(lifecycleReducer(state, { type: 'consent-granted' }).phase).toBe('uploading');
});

it('MinerU 失败不改变 PDF 可读状态', () => {
  const state = lifecycleReducer({ ...initialLifecycleState, pdfReady: true }, { type: 'parse-failed', error: 'MINERU_TIMEOUT' });
  expect(state).toMatchObject({ pdfReady: true, phase: 'failed' });
});
```

在 `workspace-reducer.ts` 中实现测试使用的状态机：

```ts
export type LifecyclePhase = 'idle' | 'awaiting-consent' | 'uploading' | 'parsing' | 'translating' | 'ready' | 'failed';
export interface LifecycleState { phase: LifecyclePhase; pdfReady: boolean; error?: string }
export type LifecycleAction =
  | { type: 'source-loaded'; sourceKind: 'remote' | 'authenticated' | 'local' }
  | { type: 'consent-granted' }
  | { type: 'parse-started' }
  | { type: 'parse-done' }
  | { type: 'parse-failed'; error: string };
export const initialLifecycleState: LifecycleState = { phase: 'idle', pdfReady: false };
export function lifecycleReducer(state: LifecycleState, action: LifecycleAction): LifecycleState {
  if (action.type === 'source-loaded') return { ...state, pdfReady: true, phase: action.sourceKind === 'remote' ? 'parsing' : 'awaiting-consent' };
  if (action.type === 'consent-granted') return { ...state, phase: 'uploading' };
  if (action.type === 'parse-started') return { ...state, phase: 'parsing' };
  if (action.type === 'parse-done') return { ...state, phase: 'translating', error: undefined };
  return { ...state, phase: 'failed', error: action.error };
}
```

- [ ] **步骤 2：实现持久任务恢复**

Service Worker 启动时读取 `tasks` 中状态为 `parsing` 的任务，调用 `waitForResult(taskId)`；完成后写入 `DocumentModel`，失败时保存结构化错误码。恢复逻辑必须按 `taskId` 去重。

```ts
const activeTasks = await taskRepository.listByStatus('parsing');
const resuming = new Set<string>();
async function resumeMineruTask(task: StoredTask) {
  if (resuming.has(task.id)) return;
  resuming.add(task.id);
  try {
    const result = await mineruClient.waitForResult(task.id);
    if (result.state !== 'done' || !result.fullZipUrl) throw new Error(result.error ?? 'MINERU_RESULT_MISSING');
    const model = await loadMineruResult(result.fullZipUrl, { sourceUrl: task.sourceUrl, hash: task.hash, title: task.title, pageCount: task.pageCount });
    await documentRepository.put(model);
    await taskRepository.put({ ...task, status: 'done' });
  } catch {
    await taskRepository.put({ ...task, status: 'failed' });
  } finally {
    resuming.delete(task.id);
  }
}
for (const task of activeTasks) void resumeMineruTask(task);
```

- [ ] **步骤 3：实现有限重试与可见错误**

翻译页记录 `attempts`，最多自动重试 3 次；HTTP 401/403 不重试，HTTP 429/5xx 使用 1、2、4 秒退避。UI 显示错误码、重试按钮和设置入口，不显示 API Key 或响应原文。

```ts
const retryable = status === 429 || status >= 500;
if (!retryable || attempts >= 3) throw new ProviderError(code, false);
await sleep(1000 * 2 ** attempts);
```

- [ ] **步骤 4：实现缓存与隐私操作**

本地文件、Cookie PDF 上传前显示目标服务 `MinerU`、文件名、大小和“将发送到第三方解析服务”提示；只有点击确认后调用 `createUploadTask()`。单篇清理按钮调用 `clearDocumentCache(document.hash)`，全量清理按钮调用 `clearAllCache()`；两者成功后清空对应 React 状态并显示“缓存已清除”。

运行：`npm test -- tests/unit/pdf/workspace-reducer.test.ts && npm run check`  
预期：状态测试和全量检查通过。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin
git commit -m "feat: recover pdf tasks and surface errors"
```

### 任务 8：完成 PDF MVP 浏览器验收

**文件：**
- 创建：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 修改：`web-translate-plugin/README.md`
- 修改：`docs/superpowers/specs/2026-07-11-pdf-takeover-probe-results.md`

**接口：**
- 产出：可重复执行的 PDF MVP 验收流程和安装说明。

- [ ] **步骤 1：编写核心端到端场景**

```ts
import { chromium, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

test('启用后 URL 不变、当前页优先，并可用引用跳页', async () => {
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const pdfBytes = await readFile(resolve('fixtures/probe.pdf'));
  const mineruZip = zipSync({ 'probe_content_list.json': strToU8(JSON.stringify([
    { page_idx: 0, type: 'title', text: 'Paper' },
    { page_idx: 1, type: 'text', text: 'Main contribution' },
  ])) });
  await context.route('https://pdf.example.test/paper.pdf', (route) => route.fulfill({ contentType: 'application/pdf', body: pdfBytes }));
  await context.route('https://mineru.example.test/api/v4/extract/task', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { task_id: 't1' } }) }));
  await context.route('https://mineru.example.test/api/v4/extract/task/t1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { state: 'done', full_zip_url: 'https://mineru.example.test/result.zip' } }) }));
  await context.route('https://mineru.example.test/result.zip', (route) => route.fulfill({ contentType: 'application/zip', body: mineruZip }));
  await context.route('https://api.example.test/v1/chat/completions', async (route) => {
    const raw = route.request().postData() ?? '';
    let content = '主要贡献 [p:2]';
    if (raw.includes('"blocks"')) {
      const request = route.request().postDataJSON() as { messages: { content: string }[] };
      const payload = JSON.parse(request.messages.at(-1)!.content) as { blocks: { id: string }[] };
      content = JSON.stringify({ translations: payload.blocks.map((block) => ({ id: block.id, text: '主要贡献' })) });
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
  });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  await control.evaluate(() => chrome.storage.local.set({ settings: {
    openAi: { baseUrl: 'https://api.example.test/v1', apiKey: 'test', model: 'test-model' },
    mineru: { baseUrl: 'https://mineru.example.test', token: 'test', modelVersion: 'vlm' },
    sourceLanguage: 'en', targetLanguage: 'zh-CN',
  } }));
  const page = await context.newPage();
  await page.goto('https://pdf.example.test/paper.pdf#page=2');
  const originalUrl = page.url();
  const tabId = await control.evaluate(async () => (await chrome.tabs.query({ url: 'https://pdf.example.test/paper.pdf*' }))[0].id!);
  await control.evaluate((id) => chrome.runtime.sendMessage({ type: 'pdf:enable', tabId: id }), tabId);
  await expect(page.locator('[data-renderer="pdfjs"]')).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await expect(page.locator('[data-translation-page="2"]')).toHaveAttribute('data-status', 'done');
  await page.getByLabel('向论文提问').fill('作者的主要贡献是什么？');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: /第 2 页/ }).click();
  await expect(page.locator('[data-pdf-page="2"]')).toBeInViewport();
  await expect(page.locator('[data-translation-page="2"]')).toBeInViewport();
  await context.close();
});
```

- [ ] **步骤 2：复跑 Phase 0 全矩阵**

对 arXiv、公开 HTTPS、重定向、Cookie 和本地 PDF 逐项验证：URL 逐字一致、PDF.js 标识、读取、刷新、历史导航、关闭恢复。任何一项失败都阻止 MVP 完成声明。

- [ ] **步骤 3：验证故障与恢复**

分别模拟 MinerU 超时、OpenAI 401、OpenAI 429、浏览器重启和单页翻译失败；确认 PDF 仍可读、错误不泄露凭据、任务可恢复、失败页可重试。

- [ ] **步骤 4：运行完整验证**

运行：`npm run check`  
预期：类型检查、全部单元测试与生产构建通过。  
运行：`npm run test:e2e -- pdf-workspace.spec.ts`  
预期：PDF 工作台端到端用例通过。  
人工矩阵预期：全部 PDF 类别通过且报告更新为本次构建结果。

- [ ] **步骤 5：提交**

```bash
git add web-translate-plugin docs/superpowers/specs/2026-07-11-pdf-takeover-probe-results.md
git commit -m "feat: complete pdf translation workspace mvp"
```
