# PDF 翻译失败诊断与滚动渲染稳定性实施计划

> **供智能体执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施并使用复选框跟踪。

**目标：** 为每个 PDF 翻译失败页提供脱敏、可复制的结构化诊断，修复有限自动重试，并消除滚动时 PDF Canvas 反复卸载造成的闪烁。

**架构：** 新建独立的 `TranslationFailure` 模型，在 Provider、逐页翻译、PDF 消息和 React 页面状态之间保留稳定错误码；UI 使用默认收起的 `<details>` 展示诊断。渲染侧把“主要可见页选择”提取为纯函数，右侧译文不再改变 PDF 渲染焦点，并把 Canvas 预加载半径扩大到 2。

**技术栈：** TypeScript 7、React 19、WXT 0.20、Chrome MV3、PDF.js、Vitest 4、Playwright 1.61。

## 全局约束

- 新增规格、计划、测试名称和用户文案使用中文。
- 不保存或展示 API Key、Authorization Header、完整 Prompt、PDF 原文、完整响应正文。
- 429、5xx 和临时网络错误最多尝试 3 次，退避为 1 秒、2 秒。
- 超时和结构化输出错误不自动重试，但允许手动重试。
- 诊断详情默认收起，不能撑高译文页固定外层。
- 本次不实现 SSE 流式输出，不改变 MinerU、翻译缓存键和智能体上下文。
- PDF Canvas 稳定窗口为活动页前后各 2 页，不渲染整篇论文。
- 开发阶段只运行定向测试；最后统一运行一次 `npm run check` 和相关 CfT/Playwright E2E。

---

## 文件结构

- 创建 `web-translate-plugin/src/translation/failure.ts`：错误分类、脱敏诊断和复制格式。
- 修改 `web-translate-plugin/src/translation/translate-page.ts`：保留错误码、重试计数与总耗时。
- 修改 `web-translate-plugin/src/providers/openai/client.ts`：不覆盖具体结构化响应错误。
- 修改 `web-translate-plugin/src/pdf/messages.ts`、`entrypoints/background.ts`：安全传递翻译失败对象。
- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`、`TranslationPane.tsx`：保存、显示、重试和复制诊断。
- 创建 `web-translate-plugin/src/pdf/visible-page.ts`：选择交叉面积最大的页面。
- 修改 `web-translate-plugin/src/pdf/PdfViewer.tsx`：稳定观察器回调和半径为 2 的 Canvas 窗口。
- 修改 CSS、Vitest 与 Playwright 测试：覆盖详情收起、脱敏、重试和 Canvas 稳定性。

---

### 任务 1：保留错误码并修复自动重试

**文件：**

- 创建：`web-translate-plugin/src/translation/failure.ts`
- 创建：`web-translate-plugin/tests/unit/translation/failure.test.ts`
- 修改：`web-translate-plugin/src/translation/translate-page.ts`
- 修改：`web-translate-plugin/tests/unit/translation/translate-page.test.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`

**接口：**

```ts
export type TranslationFailureCategory =
  | 'timeout' | 'rate-limit' | 'server' | 'network'
  | 'response-format' | 'configuration' | 'unknown';

export interface TranslationFailure {
  code: string;
  category: TranslationFailureCategory;
  summary: string;
  retryable: boolean;
  attempts: number;
  durationMs: number;
  httpStatus?: number;
  provider: 'openai-compatible';
  model: string;
  occurredAt: number;
}

export function classifyTranslationFailure(
  error: unknown,
  metadata: { attempts: number; durationMs: number; model: string; occurredAt?: number },
): TranslationFailure;

export function formatTranslationFailure(failure: TranslationFailure): string;
```

- [ ] **步骤 1：先写错误分类失败测试**

```ts
expect(classifyTranslationFailure(
  new TranslationProviderError('TRANSLATION_TIMEOUT'),
  { attempts: 1, durationMs: 30_002, model: 'qwen-plus', occurredAt: 100 },
)).toMatchObject({ code: 'TRANSLATION_TIMEOUT', category: 'timeout', retryable: true, attempts: 1 });

expect(classifyTranslationFailure(
  new TranslationProviderError('TRANSLATION_HTTP_429'),
  { attempts: 3, durationMs: 4_100, model: 'qwen-plus', occurredAt: 100 },
)).toMatchObject({ category: 'rate-limit', httpStatus: 429, retryable: true });

expect(formatTranslationFailure(failure)).not.toContain('sk-');
```

- [ ] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/translation/failure.test.ts`  
预期：模块不存在，测试失败。

- [ ] **步骤 3：实现脱敏错误分类**

从 `error.code` 或安全的 `error.message` 读取 `TRANSLATION_*` 稳定码；用正则 `^TRANSLATION_HTTP_(\d{3})$` 提取状态。摘要只由代码映射表生成，不拼接原始异常正文。`formatTranslationFailure` 只序列化接口定义中的白名单字段。

- [ ] **步骤 4：先写重试失败测试**

```ts
const client = { translate: vi.fn()
  .mockRejectedValueOnce(new TranslationProviderError('TRANSLATION_HTTP_429'))
  .mockRejectedValueOnce(new TranslationProviderError('TRANSLATION_HTTP_503'))
  .mockResolvedValueOnce([{ id: 'b1', text: '译文' }]) };
await expect(translatePage(client, page, languages, undefined, vi.fn().mockResolvedValue(undefined), 'qwen-plus'))
  .resolves.toHaveLength(1);
expect(client.translate).toHaveBeenCalledTimes(3);
```

再分别断言 `TRANSLATION_NETWORK` 重试，`TRANSLATION_TIMEOUT`、`TRANSLATION_JSON_INVALID` 和 `TRANSLATION_ID_MISSING` 只调用一次，并在最终异常的 `failure` 中保留具体错误码。

- [ ] **步骤 5：运行重试红灯测试**

运行：`npm test -- tests/unit/translation/translate-page.test.ts`  
预期：现有实现把稳定码折叠为 `TRANSLATION_FAILED`，429/503 不重试。

- [ ] **步骤 6：实现类型化最终异常**

```ts
export class PageTranslationError extends Error {
  readonly name = 'PageTranslationError';
  constructor(readonly failure: TranslationFailure) {
    super(failure.code);
  }
  get code(): string { return this.failure.code; }
}
```

`translatePage` 记录 `startedAt` 和 `attempts`；只有 429、500–599 与 `TRANSLATION_NETWORK` 进入下一次循环。最终调用 `classifyTranslationFailure`，不能再次覆盖具体错误码。

- [ ] **步骤 7：修复 Provider 错误边界**

`OpenAiTranslationClient` 只把 `LlmProviderError` 映射为 `TranslationProviderError`；`parseTranslationResponse` 抛出的 `TRANSLATION_JSON_INVALID`、Schema 和 ID 错误直接向上传递。增加测试证明 `TRANSLATION_JSON_INVALID` 不被转换为网络错误。

- [ ] **步骤 8：运行任务 1 绿灯测试并提交**

运行：`npm test -- tests/unit/translation/failure.test.ts tests/unit/translation/translate-page.test.ts tests/unit/providers/openai/client.test.ts`  
预期：全部通过。

```powershell
git add web-translate-plugin/src/translation web-translate-plugin/src/providers/openai/client.ts web-translate-plugin/tests/unit/translation web-translate-plugin/tests/unit/providers/openai/client.test.ts
git commit -m "fix: preserve PDF translation failures"
```

---

### 任务 2：通过 PDF 消息展示失败诊断

**文件：**

- 修改：`web-translate-plugin/src/pdf/messages.ts`
- 修改：`web-translate-plugin/entrypoints/background.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改：`web-translate-plugin/tests/unit/pdf/messages.test.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`

**接口：**

```ts
export type PdfMessageResponse =
  | { ok: true; value: PdfMessageValue }
  | { ok: false; error: string; failure?: TranslationFailure };

export interface PdfTranslationProgress {
  type: 'pdf:translation-progress';
  hash: string;
  page: number;
  attempt: number;
  maxAttempts: 3;
}

export class PdfMessageError extends Error {
  constructor(message: string, readonly failure?: TranslationFailure) { super(message); }
}
```

工作台保留现有 `pageStatus`，另加 `pageFailures: Map<number, TranslationFailure>`，避免一次重构所有状态消费者。

- [ ] **步骤 1：先写消息与组件失败测试**

消息测试断言含 `failure` 的响应只能包含 `TranslationFailure` 白名单字段。组件测试传入失败对象并断言：

```ts
expect(html).toContain('失败：请求超时');
expect(html).toContain('<details');
expect(html).not.toContain('<details open=""');
expect(html).toContain('复制诊断信息');
```

- [ ] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/pdf/messages.test.ts tests/unit/pdf/workspace-components.test.tsx`  
预期：响应类型、失败属性和详情 UI 尚不存在。

- [ ] **步骤 3：实现安全消息传递**

`background.ts` 遇到 `PageTranslationError` 时返回 `{ ok: false, error: failure.code, failure }`；其他 PDF 错误继续使用 `safePdfError`。`sendPdfMessage` 收到失败响应后抛出 `PdfMessageError`，不得把任意原始错误对象传进页面。

- [ ] **步骤 4：实现页面诊断状态**

请求失败时从 `PdfMessageError.failure` 写入 `pageFailures`；缺少结构化对象时使用 `classifyTranslationFailure` 生成 `TRANSLATION_FAILED` 安全兜底。开始翻译、手动重试、成功和清缓存时删除对应旧诊断。

`translatePage` 增加可选 `onAttempt(attempt: number): void` 回调。`PdfWorkspaceService` 在依赖接口中增加 `reportTranslationProgress(tabId, progress)`，默认使用 `browser.tabs.sendMessage` 向当前 PDF 内容脚本发送 `PdfTranslationProgress`；工作台监听该安全消息，并把对应页状态显示为“第 N/3 次尝试”。消息只包含 hash、页码和计数，不包含输入或响应内容。

顶部反馈改为 `已完成 X 页 · 翻译中 Y 页 · 失败 Z 页`，不再显示旧文案“正在按当前页优先翻译”。

- [ ] **步骤 5：实现默认收起的详情 UI**

```tsx
{failure && (
  <div className="translation-failure">
    <p role="alert">失败：{failure.summary}</p>
    <button type="button" onClick={() => onRetryPage(number)}>重试本页</button>
    <details>
      <summary>查看详情</summary>
      <dl>...</dl>
      <button type="button" onClick={() => onCopyFailure(failure)}>复制诊断信息</button>
    </details>
  </div>
)}
```

字段由 `TranslationFailure` 直接渲染；复制内容只调用 `formatTranslationFailure`。失败详情放在 `.translation-page-body` 内，继续使用页内滚动。

- [ ] **步骤 6：运行任务 2 绿灯测试并提交**

运行：`npm test -- tests/unit/pdf/messages.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/translation/failure.test.ts`  
预期：全部通过。

```powershell
git add web-translate-plugin/src/pdf web-translate-plugin/entrypoints/background.ts web-translate-plugin/entrypoints/pdf-workspace.content/style.css web-translate-plugin/tests/unit/pdf
git commit -m "feat: show PDF translation diagnostics"
```

---

### 任务 3：稳定当前页选择和 Canvas 窗口

**文件：**

- 创建：`web-translate-plugin/src/pdf/visible-page.ts`
- 创建：`web-translate-plugin/tests/unit/pdf/visible-page.test.ts`
- 修改：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`

**接口：**

```ts
export interface VisiblePageCandidate { page: number; intersectionRatio: number; }
export function selectDominantPage(
  candidates: readonly VisiblePageCandidate[],
  currentPage: number,
): number | null;

export function visiblePageWindow(activePage: number, pageCount: number, radius?: number): Set<number>;
```

- [ ] **步骤 1：先写主要可见页失败测试**

```ts
expect(selectDominantPage([
  { page: 2, intersectionRatio: 0.35 },
  { page: 3, intersectionRatio: 0.72 },
], 2)).toBe(3);
expect(selectDominantPage([
  { page: 2, intersectionRatio: 0.5 },
  { page: 3, intersectionRatio: 0.5 },
], 2)).toBe(2);
```

组件测试把默认渲染窗口期望改为活动页前后各 2 页，例如活动页 5 返回 `{3,4,5,6,7}`。

- [ ] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/pdf/visible-page.test.ts tests/unit/pdf/workspace-components.test.tsx`  
预期：选择函数不存在，旧窗口只有前后各 1 页。

- [ ] **步骤 3：实现稳定选择函数**

过滤非法页码和非正交叉率；按 `intersectionRatio` 降序选择。最大值并列且包含 `currentPage` 时返回当前页，否则返回页码较小者，保证确定性。

- [ ] **步骤 4：每次观察器回调只上报一个页面**

`PdfViewer` 和 `TranslationPane` 的观察器先把所有相交 entry 转成 candidate，再调用 `selectDominantPage` 一次。使用 ref 保存最近上报页，只有页码变化时才调用 `onPageVisible`。

- [ ] **步骤 5：隔离阅读页与 PDF 渲染焦点**

`PdfWorkspace` 增加 `pdfRenderPage`。只有 `pane === 'pdf'` 的可见页事件和 `navigateToPage` 更新它；右侧译文事件只更新工具栏阅读页并执行获准的同步，不修改 `pdfRenderPage`。`PdfViewer.activePage` 改为传入 `pdfRenderPage`。

- [ ] **步骤 6：扩大稳定窗口并保持 key**

`visiblePageWindow` 默认半径改为 `2`。页面 section 的 key 继续固定为页码，窗口内已有 `PdfPageCanvas` 不因相邻页切换重建。新窗口页先显示同尺寸槽位；离开半径 2 后才卸载 Canvas。

- [ ] **步骤 7：运行任务 3 绿灯测试并提交**

运行：`npm test -- tests/unit/pdf/visible-page.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/sync-controller.test.ts`  
预期：全部通过。

```powershell
git add web-translate-plugin/src/pdf web-translate-plugin/tests/unit/pdf
git commit -m "fix: stabilize PDF canvas rendering while scrolling"
```

---

### 任务 4：CfT 失败场景与完整门禁

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`

- [ ] **步骤 1：先写失败诊断 E2E 红灯断言**

测试服务根据页面返回 `429`、延迟超时或非法 JSON。至少覆盖一个 429 自动重试后最终失败页面和一个非法 JSON 页面，断言简短原因、详情默认收起、展开字段和复制按钮存在。

诊断复制通过点击按钮后读取 `navigator.clipboard.readText()` 或注入剪贴板替身，断言不包含 `sk-`、PDF 原文和请求 Prompt。

- [ ] **步骤 2：加入 Canvas 稳定性断言**

记录活动页及相邻页 Canvas 节点的测试 ID；连续滚动一个页面后断言仍是同一 DOM 节点，并断言右侧译文回填不会改变 `data-pdf-render-page`。保留 URL 不变、PDF.js 渲染和关闭恢复断言。

- [ ] **步骤 3：在旧构建上运行红灯 E2E**

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts --grep "失败诊断|Canvas 稳定"`  
预期：旧构建没有详情 UI，且相邻 Canvas 稳定性断言失败。

- [ ] **步骤 4：构建并运行完整 PDF E2E**

运行：`npm run build`  
预期：生产构建成功。

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts`  
预期：公开 PDF、认证 PDF、失败诊断和 Canvas 稳定性测试全部通过。

- [ ] **步骤 5：运行最终完整门禁**

运行：`npm run check`  
预期：类型检查、全部 Vitest 和生产构建退出码均为 `0`。

- [ ] **步骤 6：复核并提交**

运行：`git diff --check`、`git status --short`，确认没有测试产物和敏感信息。

```powershell
git add web-translate-plugin/tests/e2e/pdf-workspace.spec.ts
git commit -m "test: cover PDF failures and canvas stability"
```

最终报告列出错误分类、CfT 用例数量、Vitest 数量、构建结果和提交哈希，并提醒用户重新加载扩展。
