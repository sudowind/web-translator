# PDF 富文本渲染、Agent 流式回答与区块联动设计

## 1. 背景与目标

当前 PDF 工作台已经具备单主滚动、逐页等高配对、逐页翻译和整篇论文问答，但仍有四个阅读体验缺口：Agent 只能等待整段回答结束；译文和 Agent 回答缺少统一的 Markdown/公式排版；译文无法反向定位 PDF 原文区块；PDF 文本层只是整页透明文本，不能按原始坐标稳定框选。

本迭代目标是建立一套以 MinerU `block.id` 为核心的富文本阅读链路：

- Agent 回答以 SSE 增量显示，并保留取消、空闲超时和迟到分片隔离。
- 论文译文按 MinerU 区块类型保留标题、段落、列表、表格、图注、脚注和公式结构。
- Agent 回答和可翻译文本块统一使用安全的 Markdown、数学公式渲染。
- 悬停、键盘聚焦或点击译文块时，PDF 页面对相同 `block.id` 的坐标区域进行高亮。
- PDF.js 使用真实 TextLayer，支持按行、按片段和跨行框选复制。
- 自动化测试覆盖语义结构、流式增量、公式、表格、安全、坐标映射、文本框选和固定视口视觉基线。

## 2. 非目标

- 不在本迭代实现双向编辑、批注、永久书签或跨设备同步。
- 不让模型重新生成整页 Markdown，也不允许模型合并或拆分 MinerU 区块。
- 不翻译行间公式本身；公式必须复用解析结果中的原始 LaTeX。
- 不使用 OCR 文本进行模糊坐标匹配；缺少合法 `bbox` 的块直接降级为无高亮。
- 不执行模型输出、MinerU 输出或论文内容中的原始 HTML、脚本和事件属性。

## 3. 核心架构

### 3.1 统一区块身份

`DocumentBlock.id` 是译文、格式渲染和 PDF 高亮之间唯一的映射键。翻译 Provider 必须逐个返回原始 `id`，UI 不根据文本内容猜测映射。

每个译文区块渲染为独立的 `TranslationBlock`，至少包含：

- `data-block-id`
- 原始 `DocumentBlock.kind`
- 当前翻译结果
- 原始 LaTeX、表格内容和 `polygon`/`bbox`
- 悬停、聚焦、点击固定事件

### 3.2 组件边界

- `MarkdownContent`：安全渲染 Markdown、GFM 表格、代码、行内公式和行间公式；处理 Agent 页码引用。
- `TranslationBlock`：按区块类型选择语义容器，并把交互状态上报给页面。
- `PdfTextLayer`：包装 PDF.js `TextLayer` 的创建、取消和缩放更新。
- `PdfBlockHighlightLayer`：把 MinerU 坐标转换为覆盖层矩形，只负责视觉展示。
- `AgentPanel`：维护流式 assistant 占位消息、增量内容和完成/错误状态。
- `PdfWorkspaceService`：协调 Agent 请求、SSE 分片、取消和向指定标签页推送进度。

这些组件不互相读取 DOM。`PdfWorkspace` 保存当前临时高亮块与点击固定块，并通过 props 把状态传给同页的 PDF canvas 和译文。

## 4. Agent 流式协议

### 4.1 请求与进度消息

`pdf:agent-ask` 增加由内容脚本生成的 `requestId`。同一个标签页同时只允许一个有效 Agent 请求。

后台向发起请求的标签页发送：

```ts
interface PdfAgentProgress {
  type: 'pdf:agent-progress';
  hash: string;
  requestId: string;
  delta: string;
}
```

最终 `sendMessage` 响应仍返回完整 `answer`、上下文模式和提示信息，用作完成确认与最终一致性校验。进度消息只传增量，不携带 API Key、完整论文上下文或 Provider 原始响应。

### 4.2 Provider 行为

- `purpose: 'agent'` 的 Chat Completions 请求设置 `stream: true`。
- `OpenAiChatClient` 提供增量回调；每收到一个有效 content delta，既追加完整结果，也调用回调并重新启动空闲超时。
- 无内容的 usage 尾事件允许通过；流结束但没有任何内容时报 `AGENT_RESPONSE_INVALID`。
- HTTP、网络、空闲超时、用户取消继续映射为既有安全错误码。

### 4.3 UI 状态与竞态

提交问题后立即追加 user 消息和一个空 assistant 消息。内容脚本监听匹配 `hash + requestId` 的进度消息，以约 50ms 的节流批量追加文本。

- 最终响应到达：以最终 `answer` 覆盖增量缓冲，标记完成。
- 用户取消：终止后台请求，保留已生成内容并显示“已停止”。
- 新请求开始：旧 `requestId` 的迟到分片和最终响应全部丢弃。
- 面板卸载或 PDF 切换：移除监听器并取消未完成请求。

## 5. 译文与 Agent 富文本渲染

### 5.1 Markdown 安全边界

统一使用 `react-markdown`、`remark-math`、`rehype-katex`，并增加 GFM 支持以渲染表格、任务列表和删除线。禁止 `rehype-raw`，因此原始 HTML 不会进入真实 DOM。

链接仅允许 `http:`、`https:`、`mailto:` 和内部页码引用协议；外部链接使用 `rel="noreferrer noopener"`。不允许 `javascript:`、`data:` 或未知协议。

Agent 文本中的 `[p:N]` 在进入 Markdown 解析前转换为内部页码链接，渲染为可点击的“第 N 页”按钮；无效页码保留为普通文本。

### 5.2 翻译输入与输出约束

翻译请求的每个区块增加 `kind`，系统提示明确要求：

- 保留 Markdown 强调、列表、链接和代码结构。
- 保留 `$...$` 与 `$$...$$` 数学表达式，不翻译公式内容。
- 表格输入转换或输出为 Markdown 表格，保持行列结构。
- 每个 `id` 恰好返回一次，不合并、不拆分区块。

行间公式块不发送给翻译 Provider，直接渲染 `block.latex ?? block.text`。图片本体不翻译；图片说明、表格说明和脚注按普通文本区块翻译。

### 5.3 区块语义

- `heading`：使用页面内连续且不过度提升的标题层级。
- `paragraph`、`caption`、`footnote`、`other`：由 `MarkdownContent` 渲染。
- `list`：优先渲染模型保留的 Markdown 列表；无列表语法时仍作为列表样式区块展示。
- `table`：翻译后的 Markdown 表格；翻译缺失时显示安全的原始文本降级，不执行原始 HTML。
- `formula`：KaTeX 行间公式，`throwOnError: false`。
- `figure`：显示说明文字或资源提示，不把外部资源路径作为可执行 HTML。

流式 Agent 回答允许 Markdown 结构暂时不完整。渲染器必须容忍未闭合代码围栏和未闭合公式；KaTeX 失败时保留可读源文本，最终分片到达后自动形成完整结构。

## 6. PDF 区块高亮

### 6.1 坐标转换

MinerU `content_list.json` 的 `bbox` 为 `[x0, y0, x1, y1]`，坐标映射到 `0–1000`。兼容现有模型中的四值 bbox 和八值 polygon：八值 polygon 先取所有 x/y 的最小、最大值形成包围矩形。

转换规则：

```text
left   = x0 / 1000 * 100%
top    = y0 / 1000 * 100%
width  = (x1 - x0) / 1000 * 100%
height = (y1 - y0) / 1000 * 100%
```

坐标必须全部有限、落在 `0–1000`，且宽高为正；否则返回 `null`。覆盖层使用百分比，因此自动跟随 PDF 缩放和响应式宽度。

### 6.2 交互状态

- `pointerenter`：设置临时高亮。
- `pointerleave`：清除临时高亮；如果存在点击固定块，则恢复固定高亮。
- 键盘 `focus`/`blur`：行为与悬停一致。
- 点击译文块：固定或取消固定高亮，作为触屏和键盘替代路径。
- 同一时间只显示一个主要高亮框。

高亮框使用半透明暖黄色背景、清晰边框和轻量阴影，同时显示一个仅供辅助技术读取的“已定位原文区块”状态。颜色不是唯一反馈：被固定的译文块还显示边框和状态标识。

高亮层 `pointer-events: none`，位于 canvas 之上、TextLayer 之下，不阻塞文本选择。显示/隐藏仅使用 opacity，时长约 150ms；`prefers-reduced-motion` 下取消过渡。

## 7. PDF.js TextLayer

当前整页透明 `<p>` 必须替换为 PDF.js `TextLayer`：

1. `PdfPageCanvas` 获取与 canvas 相同的 `PageViewport`。
2. 使用 `page.streamTextContent()` 或 `page.getTextContent()` 创建 `TextLayer`。
3. TextLayer 容器与 canvas 使用相同宽高和 transform origin。
4. 组件缩放、虚拟窗口移入或 PDF 页面变化时取消旧 TextLayer，再创建新实例。
5. 卸载时调用 `cancel()`，避免旧异步渲染写入新页面。

TextLayer 文字保持透明，但必须保留真实 glyph span、`user-select: text` 和浏览器选择能力。`::selection` 使用可见的蓝色半透明背景。选中文本通过现有 `globalThis.getSelection()` 进入 Agent 上下文。

层级从下到上为：canvas、区块高亮层、TextLayer。TextLayer 允许选区事件，高亮层不接收指针事件。

## 8. 性能与可访问性

- PDF canvas 继续只渲染当前页前后各两页；TextLayer 与高亮层遵循相同窗口。
- Agent 增量按约 50ms 批量刷新，避免 token 级 React 重渲染。
- 高亮不修改页面高度、宽度或滚动位置，不触发布局抖动。
- 译文块可键盘聚焦，焦点样式清晰，点击固定状态通过 `aria-pressed` 或等效语义表达。
- Markdown 标题保持合理层级；表格放在仅横向溢出的容器中，不产生页面级横向滚动。
- 所有交互不能破坏主滚动、译文页内溢出滚动和 Agent 侧栏滚动。

## 9. 错误与降级

- Agent 流式中断：保留已收到文本，显示安全错误和重试入口。
- Markdown 或公式语法不完整：显示源文本，不让整个消息或页面崩溃。
- 翻译表格格式无效：显示普通预格式化文本。
- 区块缺少坐标：译文正常显示，仅不产生高亮。
- TextLayer 渲染失败：canvas 仍可阅读，并在页面状态中提供非阻塞提示。
- 坐标、Markdown、链接和 Provider 错误不得输出 API Key、论文完整上下文或原始响应体。

## 10. 测试与验收

### 10.1 单元测试

- Agent 请求为流式，增量回调顺序正确，空闲超时在分片后重置。
- `requestId` 校验、迟到分片隔离、取消和最终结果校准。
- Markdown 渲染包含标题、列表、代码、GFM 表格、行内公式和行间公式。
- 原始 HTML、事件属性和危险链接不会进入可执行 DOM。
- `[p:N]` 只在合法页码范围内变成跳页控件。
- 四值 bbox、八值 polygon、边界裁剪和非法坐标转换。
- 译文区块类型与 MinerU 结构一致，公式不进入翻译请求。

### 10.2 Chromium 端到端测试

固定富文本 PDF 和测试 Provider 必须覆盖：

- Agent 至少分两次 SSE delta 返回；第一个 delta 到达后、最终响应前，UI 已显示部分回答。
- Agent 最终回答包含标题、列表、代码、公式、表格和页码引用，并能跳页。
- 译文包含语义标题、Markdown 列表、表格和 KaTeX 公式。
- 悬停译文区块后，高亮框出现，矩形相对 canvas 的位置与 `bbox` 换算值误差不超过 1 CSS px；移出后按固定状态消失或保留。
- TextLayer 包含多个定位 span；程序化创建跨 span Range 后，`getSelection().toString()` 非空且内容顺序正确。
- 高亮层不会阻止文本框选。
- 固定视口下对译文页和 Agent 面板执行截图基线比较，覆盖普通、流式中和完成三种状态。

### 10.3 最终门禁

- 受影响单元测试与类型检查。
- `npm run check`。
- PDF 工作台 Playwright E2E。
- 使用 arXiv 测试论文进行一次人工体验：框选文本、悬停高亮、查看公式和 Agent 流式 Markdown；真实 Provider 凭证不写入日志、截图或提交文件。

## 11. 验收标准

- 用户提交问题后，无需等待完整响应即可看到 Agent 内容持续出现。
- Agent 和译文中的 Markdown、列表、表格、代码和数学公式结构清晰、无原始 HTML 执行风险。
- 译文块与 PDF 原文高亮一一对应，缩放后位置仍正确；无坐标块正常降级。
- PDF 文本可以按真实布局框选和复制，并可作为 Agent 选中文本上下文。
- 新交互不引入主滚动跳动、PDF 闪烁、译文高度变化或不可访问的 hover-only 能力。
- 自动化格式夹具和视觉基线能在后续修改破坏排版时稳定失败。
