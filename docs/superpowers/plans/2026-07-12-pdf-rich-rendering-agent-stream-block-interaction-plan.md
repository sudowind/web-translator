# PDF 富文本渲染、Agent 流式回答与区块联动实施计划

> **供智能体执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。所有步骤使用复选框跟踪。

**目标：** 为 PDF 工作台实现 Agent SSE 增量回答、安全 Markdown/公式排版、译文到 PDF 的区块高亮，以及可真实框选的 PDF.js TextLayer，并用固定富文本夹具完成语义与视觉验收。

**架构：** 以 `DocumentBlock.id` 作为翻译、译文 DOM 和 PDF 坐标的唯一关联键；Provider 层负责产生增量，后台服务通过带 `requestId` 的标签页消息转发，React 工作台只接收已脱敏 delta。富文本统一进入 `MarkdownContent`，PDF canvas、高亮层和 TextLayer 共用同一 `PageViewport`，避免坐标漂移。

**技术栈：** TypeScript、React 19、WXT/Chrome MV3、PDF.js 6、React Markdown、remark-math、remark-gfm、rehype-katex、KaTeX、Vitest、Playwright Chromium。

## 全局约束

- 所有规格、计划和验收说明使用中文；代码标识符、协议名和 API 名可以保留英文。
- 直接在当前用户批准的工作树执行，不创建 worktree；不得读取、输出或提交本地 LLM/MinerU 凭证。
- Agent 流式分片不得包含 API Key、论文完整上下文或 Provider 原始响应体。
- Markdown 禁止原始 HTML执行；链接只允许 `http:`、`https:`、`mailto:` 和内部页码引用。
- 行间公式不进入翻译请求，必须复用 MinerU 的原始 LaTeX。
- MinerU 坐标只接受合法的 `0–1000` 四值 bbox 或八值 polygon；非法坐标无高亮降级。
- TDD 循环只跑定向测试；所有任务完成后只运行一次 `npm run check` 和一次 PDF 工作台 E2E。
- 高亮不能改变布局或滚动位置；TextLayer 和高亮层必须服从现有 PDF ±2 页虚拟渲染窗口。

---

## 文件结构与职责

### 新增文件

- `web-translate-plugin/src/rendering/MarkdownContent.tsx`：安全 Markdown、数学公式、GFM 表格、页码引用和安全链接渲染。
- `web-translate-plugin/src/pdf/block-highlight.ts`：MinerU bbox/polygon 校验与百分比矩形转换纯函数。
- `web-translate-plugin/src/pdf/PdfBlockHighlightLayer.tsx`：无指针事件的 PDF 区块高亮覆盖层。
- `web-translate-plugin/src/pdf/PdfTextLayer.tsx`：PDF.js `TextLayer` 生命周期包装。
- `web-translate-plugin/tests/unit/rendering/markdown-content.test.tsx`：Markdown 语义、安全和引用测试。
- `web-translate-plugin/tests/unit/pdf/block-highlight.test.ts`：坐标转换边界测试。
- `web-translate-plugin/tests/unit/pdf/pdf-layers.test.tsx`：高亮层与 TextLayer 容器契约测试。
- `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/`：固定 Chromium/Windows 视觉基线。

### 主要修改文件

- `web-translate-plugin/src/providers/openai/request-builder.ts`：Agent 请求开启 SSE。
- `web-translate-plugin/src/providers/openai/sse.ts`：向调用方报告 content delta。
- `web-translate-plugin/src/providers/openai/chat-client.ts`：统一完整结果与增量回调、重置空闲超时。
- `web-translate-plugin/src/agent/client.ts`：把增量回调透传到 Agent 调用。
- `web-translate-plugin/src/pdf/messages.ts`：增加 `requestId` 和 `PdfAgentProgress` 严格校验。
- `web-translate-plugin/src/pdf/workspace-service.ts`：向发起标签页报告 Agent delta。
- `web-translate-plugin/src/pdf/PdfWorkspace.tsx`：维护流式消息和高亮状态。
- `web-translate-plugin/src/agent/AgentPanel.tsx`：使用 `MarkdownContent` 展示消息。
- `web-translate-plugin/src/providers/openai/contracts.ts`：翻译输入携带 `kind`。
- `web-translate-plugin/src/providers/openai/client.ts`：提示模型保留 Markdown/数学/表格结构。
- `web-translate-plugin/src/translation/translate-page.ts`：表格进入翻译，公式继续排除。
- `web-translate-plugin/src/pdf/TranslationPane.tsx`：按区块语义渲染并报告交互块。
- `web-translate-plugin/src/pdf/PdfViewer.tsx`：以真实 TextLayer 和高亮层替换透明整页段落。
- `web-translate-plugin/src/pdf/PairedPageViewer.tsx`：把页块、高亮状态和 PDF 层连接起来。
- `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`：Markdown、表格、TextLayer、高亮及固定状态样式。
- `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`：富文本 SSE、坐标、选区和截图验收。

---

### 任务 1：让 OpenAI Chat 客户端同时产出 Agent 增量与完整结果

**文件：**

- 修改：`web-translate-plugin/src/providers/openai/request-builder.ts`
- 修改：`web-translate-plugin/src/providers/openai/sse.ts`
- 修改：`web-translate-plugin/src/providers/openai/chat-client.ts`
- 修改：`web-translate-plugin/src/agent/client.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/sse.test.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/chat-client.test.ts`
- 测试：`web-translate-plugin/tests/unit/agent/client.test.ts`

**接口：**

- 产出：`OpenAiChatClient.complete(input, signal?, onDelta?) => Promise<string>`。
- 产出：`OpenAiPaperAgentClient.ask(context, question, signal?, onDelta?) => Promise<string>`。
- 保持：翻译 SSE 的完整内容拼接、空闲超时和无内容尾事件行为不变。

- [ ] **步骤 1：先写 Agent 请求开启流式的失败测试**

在 `request-builder.test.ts` 增加：

```ts
it('Agent 请求开启流式但不要求 JSON Object', () => {
  const { body } = buildChatRequest({ purpose: 'agent', settings, messages: [] });
  expect(body).toMatchObject({ stream: true });
  expect(body).not.toHaveProperty('response_format');
});
```

在 `sse.test.ts` 增加断言：两个 SSE delta 按顺序调用 `onDelta`，返回值仍是两段拼接后的完整字符串。

- [ ] **步骤 2：运行定向测试并确认红灯**

运行：

```powershell
npx vitest run tests/unit/providers/openai/request-builder.test.ts tests/unit/providers/openai/sse.test.ts tests/unit/providers/openai/chat-client.test.ts tests/unit/agent/client.test.ts
```

预期：Agent body 缺少 `stream`，SSE 读取函数不接受增量回调。

- [ ] **步骤 3：实现最小增量接口**

接口固定为：

```ts
export async function readChatCompletionSse(
  response: Response,
  onActivity: () => void,
  onDelta?: (delta: string) => void,
): Promise<string>;

async complete(
  input: CompleteChatInput,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<string>;
```

`readChatCompletionSse` 只在 `delta` 为非空字符串时执行 `onDelta(delta)`；`onActivity` 仍对合法无内容事件重置空闲超时。`buildChatRequest` 对 `translation` 和 `agent` 设置 `stream: true`，但只对 `translation`设置 `response_format`。

- [ ] **步骤 4：验证回调、超时和既有翻译流全部通过**

运行步骤 2 的命令。预期：所有文件通过，并保留“空 choices 尾事件”“流中断”“空闲超时”测试。

- [ ] **步骤 5：提交 Provider 里程碑**

```powershell
git add web-translate-plugin/src/providers/openai web-translate-plugin/src/agent/client.ts web-translate-plugin/tests/unit/providers/openai web-translate-plugin/tests/unit/agent/client.test.ts
git commit -m "feat: stream paper agent responses"
```

---

### 任务 2：建立带 requestId 的 Agent 标签页增量协议

**文件：**

- 修改：`web-translate-plugin/src/pdf/messages.ts`
- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/messages.test.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`

**接口：**

- 产出：`PdfAgentProgress` 和 `isPdfAgentProgress(value)`。
- 修改：`pdf:agent-ask` 必须携带非空 `requestId`。
- 产出：依赖端口 `reportAgentProgress(tabId, progress)`。

- [ ] **步骤 1：写严格消息校验和服务转发失败测试**

测试合法消息：

```ts
const progress = {
  type: 'pdf:agent-progress',
  hash: 'sha256:x',
  requestId: 'agent-1',
  delta: '部分回答',
};
expect(isPdfAgentProgress(progress)).toBe(true);
```

同时测试空 `requestId`、空 `delta`、额外字段和错误 type 均返回 `false`。服务测试注入 `reportAgentProgress` spy，让假 Agent 连续调用 `onDelta('甲')`、`onDelta('乙')`，断言转发顺序、tabId、hash、requestId 完全一致。

- [ ] **步骤 2：运行消息与服务测试并确认红灯**

```powershell
npx vitest run tests/unit/pdf/messages.test.ts tests/unit/pdf/workspace-service.test.ts
```

- [ ] **步骤 3：实现协议与后台转发**

新增类型：

```ts
export interface PdfAgentProgress {
  type: 'pdf:agent-progress';
  hash: string;
  requestId: string;
  delta: string;
}
```

`WorkspaceService.ask` 调用 Agent 时传入：

```ts
(delta) => this.dependencies.reportAgentProgress?.(tabId, {
  type: 'pdf:agent-progress',
  hash: message.hash,
  requestId: message.requestId,
  delta,
})
```

默认实现使用 `browser.tabs.sendMessage(tabId, progress)`，失败只做静默清理，不能使主 Agent 请求失败。

- [ ] **步骤 4：验证取消与新请求替换行为**

在服务测试中保留既有同标签页请求互斥测试，并新增：旧 Agent 被取消后产生的回调不会污染新 `requestId`。运行步骤 2 命令，预期全部通过。

- [ ] **步骤 5：提交消息协议里程碑**

```powershell
git add web-translate-plugin/src/pdf/messages.ts web-translate-plugin/src/pdf/workspace-service.ts web-translate-plugin/tests/unit/pdf/messages.test.ts web-translate-plugin/tests/unit/pdf/workspace-service.test.ts
git commit -m "feat: relay agent stream progress"
```

---

### 任务 3：在工作台中增量维护 Agent assistant 消息

**文件：**

- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/src/agent/context-builder.ts`
- 修改：`web-translate-plugin/src/agent/AgentPanel.tsx`
- 修改：`web-translate-plugin/tests/unit/agent/panel.test.tsx`
- 新增或修改：`web-translate-plugin/tests/unit/pdf/agent-stream-state.test.ts`

**接口：**

- 产出纯函数：`appendAgentDelta(messages, requestId, delta)` 与 `finalizeAgentAnswer(messages, requestId, answer)`，或等价 reducer。
- `AgentMessage` 增加仅用于 UI 的可选 `requestId` 和 `status: 'streaming' | 'done' | 'stopped' | 'failed'`；发送历史给模型前剥离这些 UI 字段。

- [ ] **步骤 1：为迟到分片、最终校准和停止状态写 reducer 红灯测试**

必须覆盖：

```ts
expect(reduce(state, deltaFor('old'))).toEqual(state);
expect(reduce(streaming('r1', '甲'), deltaFor('r1', '乙')).content).toBe('甲乙');
expect(reduce(streaming('r1', '临时'), finalFor('r1', '最终')).content).toBe('最终');
expect(reduce(streaming('r1', '部分'), stopFor('r1')).status).toBe('stopped');
```

- [ ] **步骤 2：运行 Agent UI 定向测试并确认红灯**

```powershell
npx vitest run tests/unit/pdf/agent-stream-state.test.ts tests/unit/agent/panel.test.tsx
```

- [ ] **步骤 3：实现 requestId 生命周期和约 50ms 批量刷新**

`askAgent` 使用 `crypto.randomUUID()` 创建 requestId，立即追加 user 与空 assistant。运行时 listener 只接受当前 `model.hash + requestId`。delta 先进入 ref 缓冲，再用单个 50ms timer 批量 dispatch；最终响应到达前先 flush，随后用最终 answer 校准。

组件卸载、清缓存和新请求开始时必须清除 timer。`stopAgent` 保留部分回答并标记 `stopped`，不能再把通用错误字符串附加为新消息。

- [ ] **步骤 4：验证状态函数与面板状态文案**

运行步骤 2 命令。预期：迟到 delta 被丢弃，停止后保留部分回答，busy 状态仍可被屏幕阅读器获知。

- [ ] **步骤 5：提交 Agent UI 流式里程碑**

```powershell
git add web-translate-plugin/src/pdf/PdfWorkspace.tsx web-translate-plugin/src/agent web-translate-plugin/tests/unit/agent web-translate-plugin/tests/unit/pdf/agent-stream-state.test.ts
git commit -m "feat: render agent answers incrementally"
```

---

### 任务 4：建立统一安全 Markdown 与数学公式渲染器

**文件：**

- 修改：`web-translate-plugin/package.json`
- 修改：`web-translate-plugin/package-lock.json`
- 新增：`web-translate-plugin/src/rendering/MarkdownContent.tsx`
- 新增：`web-translate-plugin/tests/unit/rendering/markdown-content.test.tsx`
- 修改：`web-translate-plugin/src/agent/AgentPanel.tsx`

**接口：**

- 产出：

```ts
interface MarkdownContentProps {
  content: string;
  pageCount?: number;
  onNavigatePage?(page: number): void;
  className?: string;
}
```

- [ ] **步骤 1：安装 GFM 依赖**

```powershell
npm install --cache .\.npm-cache remark-gfm
```

预期：只修改 `package.json` 和锁文件，不升级无关依赖。

- [ ] **步骤 2：写富文本、安全链接和页码引用失败测试**

用 `renderToStaticMarkup` 验证输入包含：`# 标题`、列表、代码围栏、Markdown 表格、`$x^2$`、`$$E=mc^2$$`、`[p:2]`、`<img onerror=...>`、`[危险](javascript:alert(1))`。

断言输出包含 `h1`、`ul`、`code`、`table`、`katex` 和页码按钮；不包含真实 `img`、`onerror`、`javascript:`。

- [ ] **步骤 3：运行 Markdown 测试并确认红灯**

```powershell
npx vitest run tests/unit/rendering/markdown-content.test.tsx tests/unit/agent/panel.test.tsx
```

- [ ] **步骤 4：实现 MarkdownContent 并替换 Agent 纯文本渲染**

使用：

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex]}
  urlTransform={safeMarkdownUrl}
  components={{ a: SafeLinkOrPageReference }}
>
  {normalizePageReferences(content, pageCount)}
</ReactMarkdown>
```

内部页码协议必须由自定义 `a` 组件截获，不能传给浏览器导航。不要引入 `rehype-raw`。

- [ ] **步骤 5：验证 Markdown 与 Agent 组件**

运行步骤 3 命令，预期全部通过。

- [ ] **步骤 6：提交统一富文本渲染器**

```powershell
git add web-translate-plugin/package.json web-translate-plugin/package-lock.json web-translate-plugin/src/rendering web-translate-plugin/src/agent/AgentPanel.tsx web-translate-plugin/tests/unit/rendering web-translate-plugin/tests/unit/agent/panel.test.tsx
git commit -m "feat: render safe markdown and math"
```

---

### 任务 5：按 MinerU 区块结构翻译并渲染译文

**文件：**

- 修改：`web-translate-plugin/src/providers/openai/contracts.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/translation/translate-page.ts`
- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`
- 修改：`web-translate-plugin/tests/unit/translation/translate-page.test.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`

**接口：**

- `TranslationBlockInput` 增加 `kind: BlockKind`。
- `TranslationPage` 增加 `onBlockPreview(blockId | null)`、`onBlockPin(blockId)`、`pinnedBlockId`。

- [ ] **步骤 1：写翻译输入和语义输出红灯测试**

构造包含 heading、paragraph、list、table、formula、caption 的页面，断言：

- 公式不进入 Provider 请求。
- 表格输入使用 `block.html ?? block.text`，并带 `kind: 'table'`。
- 所有其他可翻译块保持 id、kind 和顺序。
- 渲染结果包含语义标题、Markdown 列表、`table`、`katex`、`data-block-id`。

- [ ] **步骤 2：运行翻译和工作台组件测试并确认红灯**

```powershell
npx vitest run tests/unit/providers/openai/client.test.ts tests/unit/translation/translate-page.test.ts tests/unit/pdf/workspace-components.test.tsx
```

- [ ] **步骤 3：收紧翻译提示和区块请求**

系统提示必须明确：

```text
Preserve Markdown structure, inline/display math delimiters, code fences and table rows/columns.
Do not translate math expressions. Return every id exactly once; never merge or split blocks.
For table blocks, return a Markdown table.
```

请求 JSON 包含 `id`、`kind`、`text`。响应 schema 保持 `{ translations: [{ id, text }] }`，避免扩大缓存格式。

- [ ] **步骤 4：实现 TranslationBlock 语义渲染和交互事件**

公式直接使用 KaTeX；其他已翻译文本进入 `MarkdownContent`。每个块的外层包含：

```tsx
<article
  data-block-id={block.id}
  tabIndex={block.polygon ? 0 : undefined}
  onPointerEnter={() => onBlockPreview(block.id)}
  onPointerLeave={() => onBlockPreview(null)}
  onFocus={() => onBlockPreview(block.id)}
  onBlur={() => onBlockPreview(null)}
  onClick={() => onBlockPin(block.id)}
>
```

表格置于局部横向滚动包装，不允许扩大整页宽度。

- [ ] **步骤 5：运行定向测试并验证既有 JSON 兼容**

运行步骤 2 命令。预期：旧 `{blocks:[...]}` Provider 兼容测试仍通过，公式未被翻译，表格结构可见。

- [ ] **步骤 6：提交结构化译文里程碑**

```powershell
git add web-translate-plugin/src/providers/openai web-translate-plugin/src/translation/translate-page.ts web-translate-plugin/src/pdf/TranslationPane.tsx web-translate-plugin/tests/unit/providers/openai web-translate-plugin/tests/unit/translation web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx
git commit -m "feat: preserve translated paper structure"
```

---

### 任务 6：实现 MinerU 坐标转换与 PDF 高亮层

**文件：**

- 新增：`web-translate-plugin/src/pdf/block-highlight.ts`
- 新增：`web-translate-plugin/src/pdf/PdfBlockHighlightLayer.tsx`
- 新增：`web-translate-plugin/tests/unit/pdf/block-highlight.test.ts`
- 新增：`web-translate-plugin/tests/unit/pdf/pdf-layers.test.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改：`web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`

**接口：**

```ts
interface HighlightRectPercent {
  left: number;
  top: number;
  width: number;
  height: number;
}

function mineruPolygonToPercentRect(values?: number[]): HighlightRectPercent | null;
```

- [ ] **步骤 1：写坐标转换红灯测试**

覆盖：

```ts
expect(mineruPolygonToPercentRect([100, 200, 700, 800])).toEqual({
  left: 10, top: 20, width: 60, height: 60,
});
expect(mineruPolygonToPercentRect([100,200, 700,200, 700,800, 100,800])).toEqual(...);
expect(mineruPolygonToPercentRect([0, 0, 1001, 10])).toBeNull();
expect(mineruPolygonToPercentRect([10, 10, 10, 20])).toBeNull();
```

- [ ] **步骤 2：运行坐标和层组件测试并确认红灯**

```powershell
npx vitest run tests/unit/pdf/block-highlight.test.ts tests/unit/pdf/pdf-layers.test.tsx
```

- [ ] **步骤 3：实现纯函数与无指针事件覆盖层**

`PdfBlockHighlightLayer` 只接收当前 `DocumentBlock | undefined`，合法时输出：

```tsx
<div className="pdf-block-highlight-layer" aria-hidden="true">
  <div className="pdf-block-highlight" style={{ left: `${left}%`, ... }} />
</div>
```

覆盖层不得注册 pointer、wheel 或 selection handler。

- [ ] **步骤 4：连接译文预览、点击固定和同页 PDF block**

`PdfWorkspace` 保存：

```ts
const [previewBlockId, setPreviewBlockId] = useState<string | null>(null);
const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null);
const highlightedBlockId = previewBlockId ?? pinnedBlockId;
```

切页、清缓存或 model 变化时清理临时预览；固定块仅在当前文档内有效。`PairedPageViewer` 根据页内 blocks 查找 id，并只把同页块交给 `PdfPageCanvas`。

- [ ] **步骤 5：验证无坐标降级和固定状态**

扩展组件测试：无 polygon 块无 `tabIndex` 和高亮，合法块可聚焦；点击同一块第二次取消固定。运行步骤 2 命令和 `workspace-components.test.tsx`。

- [ ] **步骤 6：提交高亮层里程碑**

```powershell
git add web-translate-plugin/src/pdf web-translate-plugin/tests/unit/pdf
git commit -m "feat: highlight linked PDF blocks"
```

---

### 任务 7：用 PDF.js TextLayer 替换整页透明文本

**文件：**

- 新增：`web-translate-plugin/src/pdf/PdfTextLayer.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/pdf-layers.test.tsx`

**接口：**

- `PdfTextLayer` 接收 `page: PDFPageProxy`、`viewport: PageViewport`。
- `PdfPageCanvas` 在同一次 `getPage` 中保存 page 与 viewport，canvas、高亮层、TextLayer 共用该 viewport。

- [ ] **步骤 1：写 TextLayer 生命周期红灯测试**

mock PDF.js `TextLayer`，断言：

- 构造参数的 container 与 viewport 正确。
- `render()` 被调用一次。
- viewport 或 page 改变时旧实例 `cancel()`，新实例重新创建。
- 卸载时执行 `cancel()`。
- DOM 不再包含 `.pdf-text-layer` 的整页 `<p>`。

- [ ] **步骤 2：运行层组件测试并确认红灯**

```powershell
npx vitest run tests/unit/pdf/pdf-layers.test.tsx tests/unit/pdf/workspace-components.test.tsx
```

- [ ] **步骤 3：实现真实 TextLayer**

使用 PDF.js 6 导出的：

```ts
const layer = new TextLayer({
  textContentSource: page.streamTextContent(),
  container: containerRef.current,
  viewport,
});
await layer.render();
```

异步完成前检查取消标记；catch 中忽略已取消实例，只把真实失败上报为非阻塞页面状态。禁止把所有文本再次拼成单一字符串节点。

- [ ] **步骤 4：保证 canvas、高亮与 TextLayer 层级一致**

`pdf-page-canvas-wrap` 内固定顺序：canvas、`PdfBlockHighlightLayer`、`PdfTextLayer`。三者共享可见宽高；TextLayer 的 transform origin、缩放变量和 PDF.js span 样式来自同一 viewport。

- [ ] **步骤 5：运行层测试和 TypeScript 检查**

```powershell
npx vitest run tests/unit/pdf/pdf-layers.test.tsx tests/unit/pdf/workspace-components.test.tsx
npm run typecheck
```

- [ ] **步骤 6：提交 TextLayer 里程碑**

```powershell
git add web-translate-plugin/src/pdf/PdfTextLayer.tsx web-translate-plugin/src/pdf/PdfViewer.tsx web-translate-plugin/tests/unit/pdf
git commit -m "feat: enable selectable PDF text layer"
```

---

### 任务 8：完成专业排版、高亮状态和可访问性样式

**文件：**

- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改：`web-translate-plugin/tests/unit/rendering/markdown-content.test.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/pdf-layers.test.tsx`

**接口：**

- 不增加业务接口；建立 `.markdown-content`、`.translation-block`、`.pdf-block-highlight-layer`、`.pdf-text-layer` 样式契约。

- [ ] **步骤 1：写关键 class 与无布局偏移契约测试**

静态渲染断言 Markdown 表格有局部包装、固定译文块有 `data-pinned="true"`、高亮层 `aria-hidden`。样式测试检查高亮层使用 absolute/inset 和 `pointer-events: none`。

- [ ] **步骤 2：实现排版和状态样式**

必须包含：

- 正文行高 1.65，段落间距使用 8px/16px 节奏。
- 标题、列表、引用、代码和表格有明确层级，不使用 emoji 图标。
- 表格容器仅 `overflow-x: auto`，表头、边框、斑马纹保持高对比。
- 高亮框使用半透明暖黄色背景和深色边框；固定译文块同时显示边框与文字状态，不依赖颜色单独表达。
- TextLayer span 可选择；`::selection` 为可见蓝色背景。
- 所有新增焦点目标有 `:focus-visible`。
- 高亮过渡仅 opacity 150ms；reduced-motion 关闭过渡。

- [ ] **步骤 3：运行组件测试并手动检查 CSS 无整页横向滚动规则**

```powershell
npx vitest run tests/unit/rendering/markdown-content.test.tsx tests/unit/pdf/pdf-layers.test.tsx tests/unit/pdf/workspace-components.test.tsx
```

使用 `rg "overflow-x|pointer-events|prefers-reduced-motion" entrypoints/pdf-workspace.content/style.css` 检查规则作用域。

- [ ] **步骤 4：提交视觉样式里程碑**

```powershell
git add web-translate-plugin/entrypoints/pdf-workspace.content/style.css web-translate-plugin/tests/unit/rendering web-translate-plugin/tests/unit/pdf
git commit -m "style: polish rich PDF reading states"
```

---

### 任务 9：扩展 PDF 工作台富文本、流式、高亮和框选 E2E

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 新增：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/*.png`

**接口：**

- 测试服务器的翻译 SSE 返回 Markdown 表格、列表和行内数学。
- Agent SSE 至少拆成两个 delta，并在两段之间使用可控 Promise 屏障。
- MinerU fixture 的第一页至少两个块带确定的 `[x0,y0,x1,y1]` bbox。

- [ ] **步骤 1：先扩展 E2E 夹具与失败断言**

增加断言：

```ts
await expect(agentMessage).toContainText('部分回答'); // 第二段释放前
await expect(agentMessage.locator('table')).toBeVisible();
await expect(agentMessage.locator('.katex')).toBeVisible();
await expect(translationPage.locator('ul')).toBeVisible();
await expect(translationPage.locator('table')).toBeVisible();
```

高亮断言在 hover 后读取 canvas 与 `.pdf-block-highlight` 的 bounding rect，将预期百分比换算到 CSS px，四边误差均不超过 1px。

TextLayer 断言选择两个不同 span：

```ts
const selected = await pdfPage.evaluate(() => {
  const spans = document.querySelectorAll('.pdf-text-layer span');
  const range = document.createRange();
  range.setStart(spans[0].firstChild!, 0);
  range.setEnd(spans[1].firstChild!, spans[1].textContent!.length);
  const selection = getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString();
});
expect(selected.trim()).not.toBe('');
```

- [ ] **步骤 2：构建并运行 E2E 确认新断言红灯**

```powershell
npm run build
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

预期：旧实现不能满足部分回答、Markdown 语义、高亮或多 span 选区中的至少一项。

- [ ] **步骤 3：修正测试桩为真实 Agent SSE 时序**

测试服务器必须发送：第一条 `data:`、等待测试释放屏障、第二条 `data:`、usage 空 choices 尾事件、`[DONE]`。不得用固定长 sleep 判断流式完成；用明确的请求状态或 Promise 屏障。

- [ ] **步骤 4：生成并人工检查视觉基线**

固定 viewport 为 `1440x1000`，分别截取：

- 第一页译文完成态。
- Agent 流式中间态。
- Agent 富文本完成态。

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts --update-snapshots
```

使用本地图片查看工具逐张检查标题、段落、公式、表格、滚动条、裁切和留白；发现问题先修 CSS，再更新一次基线。视觉基线只记录测试数据，不包含真实论文或凭证。

- [ ] **步骤 5：无更新模式复跑 E2E**

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

预期：富文本、流式、高亮、框选、既有解析翻译和认证上传用例全部通过，截图零差异。

- [ ] **步骤 6：提交 E2E 与视觉基线**

```powershell
git add web-translate-plugin/tests/e2e/pdf-workspace.spec.ts web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots web-translate-plugin/entrypoints/pdf-workspace.content/style.css
git commit -m "test: verify rich PDF reading workflow"
```

---

### 任务 10：统一复核、最终门禁和真实论文人工验收说明

**文件：**

- 修改（仅发现真实缺陷时）：本计划涉及的源文件与对应定向测试。
- 不读取：`.llm-experiment.local.json`、`.mineru-experiment.local.json` 的字段值。

- [ ] **步骤 1：按规格逐项自审**

检查：Agent 增量与最终一致；旧 requestId 隔离；Markdown 无 raw HTML；公式不翻译；表格保持结构；缺坐标降级；高亮不挡选区；TextLayer 多 span；缩放后坐标一致；主滚动无跳动。

- [ ] **步骤 2：只对发现的问题执行一个合并修复波次**

每个问题先补最小失败测试，再修复；修复波次只运行相关定向测试，不重复全量门禁。

- [ ] **步骤 3：运行一次最终完整门禁**

```powershell
npm run check
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

预期：TypeScript、全部 Vitest、WXT 生产构建、PDF Playwright E2E 和视觉基线全部通过。

- [ ] **步骤 4：提供真实论文人工验收步骤**

让用户重新加载 `web-translate-plugin/.output/chrome-mv3`，打开 `https://arxiv.org/pdf/1706.03762`，依次验证：

1. Agent 回答逐步出现，公式和 Markdown 清晰。
2. 译文标题、列表、表格和公式结构正确。
3. 悬停译文块时左侧对应区域高亮，点击后可固定，再次点击取消。
4. PDF 文本可跨行框选、复制，并可作为下一次 Agent 问题的选中文本上下文。
5. 缩放和滚动后高亮仍对齐，无页面闪烁或滚动跳动。

- [ ] **步骤 5：提交最终必要修复并确认工作树**

仅当步骤 2 有代码变化时提交：

```powershell
git add web-translate-plugin
git commit -m "fix: close rich PDF reading review findings"
```

最后运行 `git status --short`，预期没有本任务遗留的未提交文件。

## 实施完成定义

- Agent 在完整回答结束前显示至少一个可见增量，取消与迟到分片不会污染当前消息。
- 译文和 Agent 能安全、美观地渲染标题、列表、表格、代码和数学公式。
- 译文区块通过 `block.id` 与 MinerU bbox 映射到 PDF 高亮，缩放后误差仍符合 E2E 阈值。
- PDF.js TextLayer 产生真实定位 span，支持跨 span 框选复制，且高亮层不截获指针。
- 固定格式夹具、截图基线、全部单元测试、构建和 PDF E2E 均通过。
- 真实 Provider 凭证未出现在日志、截图、测试夹具或 Git 提交中。
