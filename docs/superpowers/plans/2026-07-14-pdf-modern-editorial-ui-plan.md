# PDF 现代编辑型极简界面实施计划

> **面向执行智能体：** 必须使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行本计划；本项目基于共享工作树和既有协作约定，默认采用后者进行同会话批量执行。步骤使用复选框跟踪，并遵循测试驱动开发的红—绿—重构循环。

**目标：** 在不改变 PDF 翻译业务流程的前提下，把 PDF 工作台改造成使用“学术靛蓝”主题、适度紧凑译文、极简工具栏和非遮挡式 Agent 侧栏的现代论文阅读界面。

**架构：** 新建纯展示的 `WorkspaceToolbar` 收纳高频操作和原生“更多”菜单，`PdfWorkspace` 继续持有全部业务状态，只负责把现有回调和反馈传给展示组件。视觉变化集中在 PDF 工作台样式文件中，通过语义化 token、无框逐页阅读流、紧凑译文和响应式 Agent 网格完成，避免改动 PDF.js、MinerU、翻译调度和缓存边界。

**技术栈：** TypeScript 7、React 19、WXT、Chrome MV3、PDF.js、Vitest、Playwright、原生 HTML `details/summary`。

## 全局约束

- 所有规格、计划、测试名称和用户可见文案使用中文；代码标识符可保留英文。
- 不新增 npm 依赖，不运行 `npm install`，不修改 `package.json` 或锁文件。
- 不修改 MinerU、LLM、缓存、逐页翻译调度、Agent 上下文和 PDF.js 渲染窗口逻辑。
- 保持 PDF 与译文逐页配对、外层等高、单主滚动、长译文内部滚动和 PDF 文本框选。
- 主题色固定为“学术靛蓝” `#4f46e5`；区块联动不得继续使用黄色或琥珀色。
- Agent 默认关闭，关闭时不渲染占位栏；桌面展开后参与网格布局，不覆盖译文。
- 正文字号不得缩小；只收紧页内边距、区块内边距、段间距、页眉和媒体占位。
- 不创建 worktree，不并行运行实现任务，不启动子智能体；除非用户在执行阶段明确改变该约束。
- 开发循环只运行列出的定向 Vitest；任务 1 不运行 typecheck，任务 2 完成两个代码批次后统一运行一次 typecheck。不得在任务 1 或任务 2 后运行 `npm run check`、完整 Vitest 或 E2E。
- 所有实现完成后只安排一次集中只读复核；Critical/Important 问题合并成一个修复波次。
- 浏览器视觉验证集中在任务 3：先构建一次，再运行一次带快照更新的 PDF E2E。只有生产代码或 E2E 断言继续变化时才允许重跑。
- 完整 `npm run check` 只在复核和修复结束后运行一次；不额外单独运行重复的全量 typecheck、Vitest 或 build。
- 命令输出已经给出耗时时直接记录，不为测时重复命令；单条全量命令超过 30 秒时记录 TypeScript、Vitest、WXT 或 Chromium 所处阶段。
- 不读取、输出或提交 `.llm-experiment.local.json`、`.mineru-experiment.local.json` 中的凭证。

## 文件结构

- 新建 `web-translate-plugin/src/pdf/WorkspaceToolbar.tsx`：极简工具栏、反馈放置规则和原生更多菜单。
- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`：Agent 默认状态、工具栏接线、条件状态提示和工作区类名。
- 修改 `web-translate-plugin/src/agent/AgentPanel.tsx`：关闭时不渲染，展开时使用连续侧栏结构。
- 修改 `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`：语义色彩、无框阅读流、紧凑译文、靛蓝联动、Agent 和响应式布局。
- 新建 `web-translate-plugin/tests/unit/pdf/workspace-toolbar.test.tsx`：工具栏结构、更多菜单和反馈放置规则。
- 新建 `web-translate-plugin/tests/unit/pdf/agent-panel.test.tsx`：Agent 关闭/展开 DOM 契约。
- 修改 `web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`：主题色、无框布局、紧凑度和非遮挡式 Agent 样式契约。
- 修改 `web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`：固定区块的无障碍契约和既有富文本回归。
- 修改 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`：默认关闭、工具栏开关、更多菜单、非遮挡布局和视觉快照。
- 更新 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/*.png`：Windows Chromium 的新版工作台、译文和 Agent 视觉基线。

---

### 任务 1：建立极简工具栏和 Agent 开关结构

**文件：**

- 新建：`web-translate-plugin/src/pdf/WorkspaceToolbar.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/src/agent/AgentPanel.tsx`
- 新建测试：`web-translate-plugin/tests/unit/pdf/workspace-toolbar.test.tsx`
- 新建测试：`web-translate-plugin/tests/unit/pdf/agent-panel.test.tsx`

**接口：**

- 产出：`workspaceFeedbackPlacement(phase: LifecyclePhase): 'toolbar' | 'notice'`。
- 产出：`WorkspaceToolbar(props: WorkspaceToolbarProps)`。
- 产出：关闭状态的 `AgentPanel` 返回 `null`。
- 保持：缩放、重试、取消、清缓存、设置和关闭工作台的现有回调语义不变。

- [ ] **步骤 1：写入工具栏和 Agent 关闭状态的失败测试**

新建 `workspace-toolbar.test.tsx`，使用 `renderToStaticMarkup` 固定以下契约：

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceToolbar,
  workspaceFeedbackPlacement,
} from '../../../src/pdf/WorkspaceToolbar';

const actions = {
  onZoomOut: vi.fn(), onZoomIn: vi.fn(), onToggleAgent: vi.fn(),
  onRetryCurrent: vi.fn(), onRetryFailed: vi.fn(), onStopAgent: vi.fn(),
  onClearCache: vi.fn(), onOpenSettings: vi.fn(), onCloseWorkspace: vi.fn(),
};

describe('PDF 极简工具栏', () => {
  it('只直接展示高频操作并把次要操作放入更多菜单', () => {
    const html = renderToStaticMarkup(<WorkspaceToolbar
      title="Attention Is All You Need"
      activePage={4}
      pageCount={15}
      progressLabel="已完成 4/15 页 · 翻译中 2 页 · 失败 0 页"
      agentOpen={false}
      canRetryFailed={false}
      canStopAgent={false}
      {...actions}
    />);

    expect(html).toContain('Attention Is All You Need');
    expect(html).toContain('4 / 15');
    expect(html).toContain('aria-label="缩小"');
    expect(html).toContain('aria-label="放大"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('论文智能体');
    expect(html).toContain('<details');
    expect(html).toContain('更多操作');
    expect(html).toContain('重试当前页');
    expect(html).toContain('清理本文缓存');
    expect(html).toContain('关闭工作台');
  });

  it('只把需要用户关注的生命周期反馈放到独立提示区', () => {
    expect(workspaceFeedbackPlacement('parsing')).toBe('notice');
    expect(workspaceFeedbackPlacement('failed')).toBe('notice');
    expect(workspaceFeedbackPlacement('translating')).toBe('toolbar');
    expect(workspaceFeedbackPlacement('ready')).toBe('toolbar');
    expect(workspaceFeedbackPlacement('idle')).toBe('toolbar');
  });
});
```

新建 `agent-panel.test.tsx`，复用最小 props 并断言：

```tsx
it('关闭时完全不渲染占位栏，展开时保留标题、消息和输入区', () => {
  const closed = renderToStaticMarkup(<AgentPanel {...props} open={false} />);
  const open = renderToStaticMarkup(<AgentPanel {...props} open />);

  expect(closed).toBe('');
  expect(open).toContain('class="agent-panel"');
  expect(open).toContain('论文智能体');
  expect(open).toContain('收起');
  expect(open).toContain('class="agent-composer"');
  expect(open).not.toContain('展开论文智能体');
});
```

- [ ] **步骤 2：只运行两个新测试并确认红灯原因**

在 `web-translate-plugin` 目录运行：

```powershell
npx vitest run tests/unit/pdf/workspace-toolbar.test.tsx tests/unit/pdf/agent-panel.test.tsx
```

预期：失败原因是 `WorkspaceToolbar` 尚不存在、Agent 关闭时仍渲染 `.collapsed`；不得因测试夹具缺少必填回调而失败。

- [ ] **步骤 3：实现工具栏纯展示组件**

在 `WorkspaceToolbar.tsx` 定义完整公开接口：

```tsx
import React from 'react';

import type { LifecyclePhase } from './workspace-reducer';

export type WorkspaceFeedbackPlacement = 'toolbar' | 'notice';

export function workspaceFeedbackPlacement(
  phase: LifecyclePhase,
): WorkspaceFeedbackPlacement {
  return ['loading-pdf', 'awaiting-consent', 'uploading', 'parsing', 'failed'].includes(phase)
    ? 'notice'
    : 'toolbar';
}

export interface WorkspaceToolbarProps {
  title: string;
  activePage: number;
  pageCount: number;
  progressLabel: string;
  agentOpen: boolean;
  canRetryFailed: boolean;
  canStopAgent: boolean;
  onZoomOut(): void;
  onZoomIn(): void;
  onToggleAgent(): void;
  onRetryCurrent(): void;
  onRetryFailed(): void;
  onRetryParsing?(): void;
  onStopAgent(): void;
  onClearCache(): void;
  onOpenSettings(): void;
  onCloseWorkspace(): void;
}
```

组件 DOM 使用一个 sticky `header.workspace-toolbar`：左侧标题；中间 `.workspace-page-controls`；右侧 `.workspace-toolbar-actions`。缩放按钮显示 `−` 和 `+`，但分别提供 `aria-label="缩小"` 与 `aria-label="放大"`。Agent 按钮使用：

```tsx
<button
  type="button"
  className="workspace-agent-toggle"
  aria-expanded={agentOpen}
  onClick={onToggleAgent}
>
  论文智能体
</button>
```

更多菜单必须使用无依赖的原生结构：

```tsx
<details className="workspace-more-menu">
  <summary aria-label="更多操作">更多</summary>
  <div className="workspace-more-menu-items">
    <button type="button" onClick={onRetryCurrent}>重试当前页</button>
    <button type="button" disabled={!canRetryFailed} onClick={onRetryFailed}>重试失败页</button>
    {onRetryParsing && <button type="button" onClick={onRetryParsing}>重试解析</button>}
    <button type="button" disabled={!canStopAgent} onClick={onStopAgent}>取消当前任务</button>
    <button type="button" onClick={onClearCache}>清理本文缓存</button>
    <button type="button" onClick={onOpenSettings}>设置</button>
    <button type="button" onClick={onCloseWorkspace}>关闭工作台</button>
  </div>
</details>
```

不在组件内部持有业务状态，也不引入菜单库。

- [ ] **步骤 4：接入工作台并删除关闭态占位栏**

在 `PdfWorkspace.tsx`：

```tsx
const [agentOpen, setAgentOpen] = React.useState(false);
const pageCount = model?.pageCount ?? documentPageCount;
const feedbackPlacement = workspaceFeedbackPlacement(lifecycle.phase);
const hasFailedPages = Array.from(pageStatus.values()).some((status) => status === 'failed');
```

用 `WorkspaceToolbar` 替换当前所有同权按钮，并把现有回调逐一传入；`onRetryParsing` 仅在 `lifecycle.phase === 'failed' && source?.kind === 'remote'` 时传递。工作区类名改为：

```tsx
<div className={`workspace-content ${agentOpen ? 'agent-open' : 'agent-closed'}`}>
```

只有 `feedbackPlacement === 'notice'` 时渲染现有 `.workspace-status`；常规翻译进度只通过工具栏 `progressLabel` 显示。

在 `AgentPanel.tsx` 删除关闭态 `<aside className="agent-panel collapsed">`，改为：

```tsx
if (!open) return null;
```

把通知、忙碌状态、错误和消息列表包入 `.agent-panel-body`，给现有表单增加 `className="agent-composer"`：

```tsx
<aside className="agent-panel" aria-label="论文智能体">
  <header className="agent-panel-header">
    <strong>论文智能体</strong>
    <button type="button" onClick={onToggle}>收起</button>
  </header>
  <div className="agent-panel-body">
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">模型正在思考或生成回答…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="agent-messages">
      {messages.map((message, index) => (
        <div key={index} data-role={message.role} data-status={message.status}>
          <MarkdownContent
            content={message.content || (message.status === 'streaming' ? '正在生成…' : '')}
            pageCount={pageCount}
            onNavigatePage={onNavigate}
          />
        </div>
      ))}
    </div>
  </div>
  <form className="agent-composer" onSubmit={(event) => {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    setQuestion('');
    void onAsk(value);
  }}>
    <label htmlFor="pdf-agent-question">向论文提问</label>
    <textarea id="pdf-agent-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
    <div className="agent-actions">
      <button type="submit" disabled={busy || !question.trim()}>发送</button>
      <button type="button" disabled={!busy} onClick={onStop}>停止</button>
    </div>
  </form>
</aside>
```

这一步只移动现有 JSX，不创建新的数据转换函数；流式消息、Markdown 和页码引用逻辑保持原样。同步让 `agent-panel.test.tsx` 断言 `.agent-panel-header`、`.agent-panel-body` 和 `.agent-composer` 都存在。

- [ ] **步骤 5：运行同一组定向测试并确认绿灯**

```powershell
npx vitest run tests/unit/pdf/workspace-toolbar.test.tsx tests/unit/pdf/agent-panel.test.tsx
```

预期：两个文件全部通过；不运行 typecheck、完整 Vitest 或构建。

- [ ] **步骤 6：提交结构里程碑**

```powershell
git add src/pdf/WorkspaceToolbar.tsx src/pdf/PdfWorkspace.tsx src/agent/AgentPanel.tsx tests/unit/pdf/workspace-toolbar.test.tsx tests/unit/pdf/agent-panel.test.tsx
git commit -m "feat: simplify PDF workspace controls"
```

---

### 任务 2：一次性完成学术靛蓝视觉系统和紧凑阅读样式

**文件：**

- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改测试：`web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`
- 修改测试：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 回归测试：`web-translate-plugin/tests/unit/pdf/paired-page-viewer.test.tsx`

**接口：**

- 产出：语义 token `--pdf-primary`、`--pdf-primary-soft`、`--pdf-canvas-bg`、`--pdf-surface`、`--pdf-text`、`--pdf-text-muted`、`--pdf-divider`、`--pdf-error`。
- 产出：`.workspace-content.agent-closed` 与 `.workspace-content.agent-open` 响应式网格。
- 保持：`.translation-page-body` 的内部纵向滚动、`.pdf-text-layer` 的文本框选和 `.pdf-block-highlight-layer` 的 `pointer-events: none`。

- [ ] **步骤 1：把样式测试改成新版视觉契约并确认红灯**

在 `pdf-styles.test.ts` 保留文本层、公式和 reduced-motion 断言，替换旧“已固定”伪元素断言并增加：

```ts
expect(css).toContain('--pdf-primary: #4f46e5');
expect(css).toContain('--pdf-primary-soft: #eef2ff');
expect(css).not.toMatch(/#a16207|#fef3c7|#fde68a|rgb\(250 204 21/i);
expect(css).not.toContain('.translation-block[data-pinned="true"]::after');
expect(css).toMatch(/\.translation-block\[data-pinned="true"\][^}]*box-shadow:\s*inset 2px 0 var\(--pdf-primary\)/s);
expect(css).toMatch(/\.page-pair-pdf[^}]*border:\s*0/s);
expect(css).toMatch(/\.page-pair-translation[^}]*border:\s*0/s);
expect(css).toMatch(/\.translation-media-placeholder[^}]*min-height:\s*5[02]px/s);
expect(css).not.toMatch(/\.translation-media-placeholder[^}]*border:\s*1px dashed/s);
expect(css).toMatch(/\.workspace-content\.agent-closed[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) 180px');
expect(css).toContain('@media (max-width: 899px)');
```

在 `workspace-components.test.tsx` 的固定段落断言中保留：

```ts
expect(html).toContain('data-pinned="true"');
expect(html).toContain('aria-pressed="true"');
```

运行：

```powershell
npx vitest run tests/unit/pdf/pdf-styles.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/paired-page-viewer.test.tsx
```

预期：样式测试因旧颜色、卡片边框、虚线媒体卡和 180px 收起列失败；组件与页对回归仍可通过。

- [ ] **步骤 2：集中替换颜色和基础层级**

在 `style.css` 顶部定义：

```css
:root[data-web-translate-pdf-workspace="true"] {
  color: #111827;
  background: #f3f4f6;
  font: 15px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --pdf-primary: #4f46e5;
  --pdf-primary-hover: #4338ca;
  --pdf-primary-soft: #eef2ff;
  --pdf-primary-muted: #e0e7ff;
  --pdf-canvas-bg: #f3f4f6;
  --pdf-surface: #fff;
  --pdf-text: #111827;
  --pdf-text-muted: #667085;
  --pdf-divider: #e5e7eb;
  --pdf-error: #b42318;
}
```

删除旧 `--pdf-border`、黄色/琥珀色高亮和散落的蓝色硬编码；普通文本、背景、分隔线和主题状态全部引用上述 token。错误仍引用 `--pdf-error`。

- [ ] **步骤 3：完成工具栏、无框页对和紧凑译文样式**

按以下硬约束重写对应规则：

```css
.workspace-toolbar { min-height: 56px; border-bottom: 1px solid var(--pdf-divider); background: color-mix(in srgb, var(--pdf-surface) 94%, transparent); }
.workspace-toolbar button, .workspace-more-menu summary { min-width: 44px; min-height: 44px; border: 0; background: transparent; }
.workspace-toolbar button:hover, .workspace-more-menu summary:hover { color: var(--pdf-primary-hover); background: var(--pdf-primary-soft); }
.workspace-agent-toggle[aria-expanded="true"] { color: var(--pdf-primary); background: var(--pdf-primary-soft); }
.workspace-more-menu { position: relative; }
.workspace-more-menu-items { position: absolute; right: 0; min-width: 220px; border: 1px solid var(--pdf-divider); background: var(--pdf-surface); box-shadow: 0 12px 30px rgb(17 24 39 / 14%); }

.workspace-content.agent-closed { grid-template-columns: minmax(0, 1fr); }
.workspace-content.agent-open { grid-template-columns: minmax(0, 1fr) minmax(340px, 360px); }
.page-pair { gap: 20px; }
.page-pair-pdf, .page-pair-translation { border: 0; border-radius: 0; background: transparent; }
.pdf-page-canvas-wrap { background: var(--pdf-surface); box-shadow: 0 8px 24px rgb(17 24 39 / 14%); }

.translation-page { padding: 16px 18px; background: var(--pdf-surface); }
.translation-page > header { border-bottom: 0; color: var(--pdf-text-muted); font-size: 13px; }
.translation-page-body { overflow-x: hidden; overflow-y: auto; }
.translation-block { padding: 4px 6px; border: 0; border-radius: 5px; }
.translation-block + .translation-block { margin-top: 2px; }
.markdown-content { line-height: 1.62; }
.markdown-content :is(p, ul, ol, blockquote, pre, .markdown-table-wrap) { margin: 6px 0; }
.translation-formula { padding: 10px 0; }
```

页码、标题层级和失败详情保留现有语义；标题上下间距整体缩小约 25%，不降低正文字号。

- [ ] **步骤 4：完成靛蓝联动、媒体信息行和 Agent 连续侧栏**

```css
.pdf-block-highlight { border: 1px solid rgb(79 70 229 / 72%); border-radius: 3px; background: rgb(79 70 229 / 14%); box-shadow: none; }
.translation-block[role="button"]:hover { background: rgb(79 70 229 / 6%); }
.translation-block[data-pinned="true"] { background: rgb(79 70 229 / 10%); box-shadow: inset 2px 0 var(--pdf-primary); }

.translation-media-placeholder { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: center; min-height: 52px; padding: 8px 0; border: 0; border-top: 1px solid var(--pdf-divider); background: transparent; }
.translation-media-label { color: var(--pdf-primary); background: transparent; font-size: 13px; font-weight: 650; }

.agent-panel { position: sticky; top: 68px; max-height: calc(100dvh - 80px); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; border: 0; border-left: 1px solid var(--pdf-divider); border-radius: 0; background: var(--pdf-surface); }
.agent-panel-body { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.agent-messages { min-height: 0; flex: 1; overflow-y: auto; }
.agent-messages [data-role="assistant"] { padding: 0; background: transparent; }
.agent-messages [data-role="user"] { padding: 9px 10px; background: var(--pdf-primary-soft); }
.agent-composer { border-top: 1px solid var(--pdf-divider); background: var(--pdf-surface); }
```

响应式规则：

```css
@media (max-width: 1279px) {
  .workspace-content.agent-open .page-pair { height: auto !important; grid-template-columns: 1fr; }
}

@media (max-width: 899px) {
  .workspace-content.agent-open, .workspace-content.agent-closed { grid-template-columns: 1fr; }
  .page-pair { height: auto !important; grid-template-columns: 1fr; }
  .agent-panel { position: fixed; inset: 56px 0 0; z-index: 40; max-height: none; border-left: 0; }
}
```

不得为 Agent 网格宽度或页对高度添加动画；只保留背景色、透明度和现有高亮淡入过渡，并在 reduced-motion 下关闭。

- [ ] **步骤 5：运行一次合并后的定向回归和里程碑类型检查**

```powershell
npx vitest run tests/unit/pdf/pdf-styles.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/paired-page-viewer.test.tsx tests/unit/pdf/workspace-toolbar.test.tsx tests/unit/pdf/agent-panel.test.tsx
npm run typecheck
```

预期：五个测试文件和 TypeScript 全部通过；不运行完整 Vitest、构建或 E2E。该 typecheck 同时覆盖任务 1 和任务 2，不在两个任务内分别重复。

- [ ] **步骤 6：提交视觉里程碑**

```powershell
git add entrypoints/pdf-workspace.content/style.css tests/unit/pdf/pdf-styles.test.ts tests/unit/pdf/workspace-components.test.tsx
git commit -m "feat: modernize PDF reading workspace"
```

---

### 任务 3：集中完成浏览器视觉验收、一次复核和最终门禁

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 更新：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png`
- 更新：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-formats-win32.png`
- 更新：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/agent-streaming-win32.png`
- 更新：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/agent-rich-answer-win32.png`
- 新建：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/editorial-workspace-agent-closed-win32.png`
- 新建：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/editorial-workspace-agent-open-win32.png`

**接口：**

- 消费：任务 1 的 `WorkspaceToolbar` 和 Agent 开关结构。
- 消费：任务 2 的学术靛蓝、无框阅读流、紧凑译文和响应式样式。
- 产出：默认关闭、非遮挡 Agent、更多菜单和完整视觉基线的浏览器证据。

- [ ] **步骤 1：更新 E2E 交互契约，不运行完整 E2E**

在 `enableWorkspace` 后增加：

```ts
await expect(pdfPage.locator('.agent-panel')).toHaveCount(0);
await expect(pdfPage.getByRole('button', { name: '论文智能体' })).toHaveAttribute('aria-expanded', 'false');
await expect(pdfPage.locator('.workspace-content')).toHaveClass(/agent-closed/);
```

在开始智能体提问前，先点击唯一工具栏按钮：

```ts
const agentToggle = pdfPage.getByRole('button', { name: '论文智能体' });
await agentToggle.click();
await expect(agentToggle).toHaveAttribute('aria-expanded', 'true');
await expect(pdfPage.locator('.agent-panel')).toBeVisible();
```

增加桌面非遮挡断言：

```ts
const overlap = await pdfPage.evaluate(() => {
  const translation = document.querySelector('[data-translation-page="1"]')!.getBoundingClientRect();
  const agent = document.querySelector('.agent-panel')!.getBoundingClientRect();
  return Math.max(0, translation.right - agent.left);
});
expect(overlap).toBe(0);
```

收起后断言 `.agent-panel` 数量为 `0`，重新打开仍点击同一个“论文智能体”按钮，不再查找“展开论文智能体”。关闭工作台前先展开“更多操作”，再点击“关闭工作台”：

```ts
await pdfPage.getByLabel('更多操作').click();
await pdfPage.getByRole('button', { name: '关闭工作台' }).click();
```

- [ ] **步骤 2：增加工作台级视觉快照**

翻译完成并回到页面顶部后增加关闭态视口快照：

```ts
await pdfPage.evaluate(() => window.scrollTo(0, 0));
await expect(pdfPage).toHaveScreenshot('editorial-workspace-agent-closed.png', {
  animations: 'disabled',
});
```

Agent 展开且尚未输入问题时增加展开态快照：

```ts
await expect(pdfPage).toHaveScreenshot('editorial-workspace-agent-open.png', {
  animations: 'disabled',
});
```

保留现有译文和 Agent 局部快照，避免用一个超长全页截图代替格式细节验证。

- [ ] **步骤 3：只构建一次并集中更新全部 PDF 快照**

```powershell
npm run build
npx playwright test tests/e2e/pdf-workspace.spec.ts --update-snapshots
```

预期：PDF 工作台 3/3 用例通过并一次性更新六张相关快照。若因生产代码错误失败，先记录唯一根因并进入单一修复波次；不得在没有代码或断言变化时重复命令。

- [ ] **步骤 4：逐张检查快照并执行一次集中只读复核**

使用图像查看工具检查六张快照：

- 工具栏只有高频操作直接可见，更多菜单未挤占首屏。
- PDF 和译文不再被两层外框包围，页面仍逐页对齐。
- 译文比旧版紧凑但没有缩小正文，标题、公式和媒体标题仍清晰。
- 所有区块联动为学术靛蓝，不存在黄色或琥珀色残留。
- Agent 关闭态不留空栏；展开态不覆盖译文。
- 助手回答没有灰色消息卡片，用户消息仍可区分。

随后只读检查任务 1–2 的提交差异，重点核对回调接线、`aria-expanded`、原生更多菜单、窄屏全屏 Agent 和既有滚动规则。把所有 Critical/Important 问题合并为一次修复；修复时只运行任务 1 或任务 2 的定向测试。只有修复改变生产代码或 E2E 断言时，才重新执行本任务的构建和 E2E 更新命令。

- [ ] **步骤 5：运行唯一一次完整发布门禁**

确认集中复核已关闭所有 Critical/Important 问题后运行：

```powershell
npm run check
```

预期：TypeScript、完整 Vitest 和 WXT Chrome MV3 构建全部通过。记录工具返回的总耗时；若超过 30 秒，直接根据该次输出记录慢在 typecheck、Vitest 或 WXT，不为分析耗时重复 `npm run check`。

如果步骤 3 的 E2E 对应的生产代码在步骤 4 后没有变化，不再无更新复跑 E2E；其结果仍是当前提交上的新鲜证据。如果步骤 4 改过生产代码，则在 `npm run check` 后再运行一次无更新 E2E：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

- [ ] **步骤 6：提交浏览器验收并检查交付状态**

```powershell
git add tests/e2e/pdf-workspace.spec.ts tests/e2e/pdf-workspace.spec.ts-snapshots
git commit -m "test: verify modern PDF workspace UI"
git status --short
git log -4 --oneline
```

预期：工作树为空；最近提交依次包含结构、视觉和浏览器验收三个里程碑。不得为了获得更整齐的日志重写或压缩既有用户提交。

## 执行效率摘要

- 实现任务只有两个代码批次，避免反复进入同一个 CSS 和组件文件。
- 开发阶段共运行两轮定向 Vitest：任务 1 一轮、任务 2 合并回归一轮。
- 两个代码批次完成后只运行一次里程碑 typecheck；最终 `npm run check` 中的再次 typecheck 属于必须保留的发布门禁，不在中间重复。
- E2E 快照集中更新一次；只有真实代码变化使证据失效时才重跑。
- 不安装依赖、不创建 worktree、不并行实现、不为每个机械步骤启动复核。
- 质量复核集中一次，问题集中修复一次，避免重复全量审查。
