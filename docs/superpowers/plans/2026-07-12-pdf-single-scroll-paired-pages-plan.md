# PDF 单主滚动与逐页配对布局实施计划

> **供智能体执行：** 必须逐项使用 `superpowers:executing-plans` 执行；每个任务严格遵循测试先行，并使用复选框跟踪进度。

**目标：** 把 PDF 与译文重构为浏览器单主滚动的逐页配对流，同时保留单页译文溢出滚动、智能体侧栏和 PDF Canvas 可见窗口渲染。

**架构：** `TranslationPane` 收缩为无列表滚动职责的单页 `TranslationPage`；新增 `PairedPageViewer` 统一加载 PDF.js 文档、生成页对、测量页高、观察浏览器视口和控制 Canvas 渲染窗口。`PdfWorkspace` 删除双栏引用与同步控制器，只保留业务状态和页面导航。

**技术栈：** React 19、TypeScript、PDF.js、CSS Grid、IntersectionObserver、ResizeObserver、Vitest、Playwright。

## 全局约束

- 主阅读区只使用浏览器页面的一个纵向滚动轴。
- 每个 PDF 页面和对应译文块严格等高。
- 只有溢出的单页译文正文和智能体消息可以独立纵向滚动。
- PDF Canvas 仍只渲染当前页前后各 2 页。
- 不改变 MinerU、LLM、缓存、逐页并发、失败诊断和智能体数据逻辑。
- 所有按钮保持至少 44×44px 点击区域和可见焦点样式。

---

### 任务 1：拆出无列表滚动职责的单页译文组件

**文件：**
- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 删除：`web-translate-plugin/src/pdf/page-wheel.ts`
- 删除：`web-translate-plugin/tests/unit/pdf/page-wheel.test.ts`

**接口：**
- 产生：`TranslationPage`，接收单个 `DocumentPage`、页码、高度、译文状态和失败操作。
- 删除：`TranslationPane` 的整篇列表、IntersectionObserver、`onPageVisible` 和 `onPageBoundary`。

- [ ] **步骤 1：把组件测试改为期望单页接口和稳定外层高度**

```tsx
const html = renderToStaticMarkup(
  <TranslationPage
    page={model.pages[0]}
    number={1}
    height={640}
    translations={new Map([['b1', { id: 'b1', text: '译文' }]])}
    status="done"
    onRetry={() => undefined}
    onCopyFailure={() => undefined}
  />,
);
expect(html).toContain('data-translation-page="1"');
expect(html).toContain('style="height:640px"');
expect(html).toContain('class="translation-page-body"');
expect(html).not.toContain('class="translation-pages"');
```

- [ ] **步骤 2：运行测试并确认因 `TranslationPage` 尚未导出而失败**

运行：`npx vitest run tests/unit/pdf/workspace-components.test.tsx`

预期：失败，提示缺少 `TranslationPage` 导出或接口不匹配。

- [ ] **步骤 3：实现单页组件**

```tsx
export function TranslationPage({
  page, number, height, translations, status, failure, attempt,
  onRetry, onCopyFailure,
}: TranslationPageProps) {
  return (
    <section
      className="translation-page"
      style={{ height }}
      data-translation-page={number}
      data-status={status}
    >
      <header>
        <h2>第 {number} 页</h2>
        <span>{attempt && (status === 'translating' || status === 'retrying')
          ? `第 ${attempt}/3 次尝试`
          : statusLabel(status)}</span>
      </header>
      <div className="translation-page-body" tabIndex={0}>
        {failure && renderFailure(failure, number, onRetry, onCopyFailure)}
        {page.blocks.map((block) => renderTranslationBlock(block, translations, status))}
      </div>
    </section>
  );
}
```

保留 KaTeX、表格、失败详情默认收起、重试和复制诊断；删除 wheel/touch/key 边界跳页事件。

- [ ] **步骤 4：运行组件测试并确认通过**

运行：`npx vitest run tests/unit/pdf/workspace-components.test.tsx`

预期：译文安全转义、公式、失败详情、尝试次数和固定高度测试全部通过。

- [ ] **步骤 5：删除不再使用的页内边界跳页模块并运行相关测试发现**

运行：`rg -n "pageWheelAction|onPageBoundary" web-translate-plugin/src web-translate-plugin/tests`

预期：没有匹配。

- [ ] **步骤 6：提交单页译文组件**

```powershell
git add web-translate-plugin/src/pdf/TranslationPane.tsx web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx
git add -u web-translate-plugin/src/pdf/page-wheel.ts web-translate-plugin/tests/unit/pdf/page-wheel.test.ts
git commit -m "refactor: isolate PDF translation pages"
```

---

### 任务 2：实现逐页配对阅读流和视口当前页

**文件：**
- 新建：`web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 新建：`web-translate-plugin/tests/unit/pdf/paired-page-viewer.test.tsx`

**接口：**
- 消费：任务 1 的 `TranslationPage`。
- 复用：`visiblePageWindow(activePage, pageCount, 2)` 和导出的 `PdfPageCanvas`。
- 产生：`PairedPageViewer`，统一渲染 `.page-pair[data-page-pair]`。

- [ ] **步骤 1：编写页对结构与等高失败测试**

```tsx
const html = renderToStaticMarkup(
  <PagePair
    number={1}
    height={720}
    pdf={<div data-testid="pdf" />}
    translation={<div data-testid="translation" />}
  />,
);
expect(html).toContain('data-page-pair="1"');
expect(html).toContain('style="height:720px"');
expect(html).toContain('class="page-pair-pdf"');
expect(html).toContain('class="page-pair-translation"');
```

- [ ] **步骤 2：运行新测试并确认模块不存在**

运行：`npx vitest run tests/unit/pdf/paired-page-viewer.test.tsx`

预期：失败，提示无法解析 `PairedPageViewer`。

- [ ] **步骤 3：实现 `PagePair` 和 `PairedPageViewer`**

`PairedPageViewer` 加载一次 PDF 文档，获得页数后按页码生成：

```tsx
<PagePair
  number={page}
  height={pageHeights.get(page) ?? 780}
  pdf={document && window.has(page)
    ? <PdfPageCanvas document={document} pageNumber={page} scale={scale} />
    : <div className="pdf-page-placeholder" />}
  translation={<TranslationPage {...translationPageProps} number={page} height={pageHeights.get(page) ?? 780} />}
/>
```

每个页对通过 ResizeObserver 测量 PDF 槽位，将高度写入内部 Map；译文接收相同高度。

- [ ] **步骤 4：在浏览器视口上观察页对**

IntersectionObserver 使用 `{ root: null, threshold: [0.25, 0.6] }`，观察 `[data-page-pair]`，调用 `selectDominantPage` 后触发 `onPageVisible(page)`。当前页变化驱动 `visiblePageWindow`，不由译文内部滚动驱动。

- [ ] **步骤 5：实现初始页和外部导航**

组件接收 `navigationPage`；首次文档就绪以及导航值明确变化时，查找页对并调用：

```ts
target.scrollIntoView({ block: 'start' });
```

CSS 使用 `scroll-margin-top` 避让 sticky 工具栏。

- [ ] **步骤 6：通过页对、可见窗口和当前页测试**

运行：

`npx vitest run tests/unit/pdf/paired-page-viewer.test.tsx tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/visible-page.test.ts`

预期：页对结构、共享高度、Canvas 窗口和 dominant page 选择全部通过。

- [ ] **步骤 7：提交配对阅读流**

```powershell
git add web-translate-plugin/src/pdf/PairedPageViewer.tsx web-translate-plugin/src/pdf/PdfViewer.tsx web-translate-plugin/tests/unit/pdf/paired-page-viewer.test.tsx web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx
git commit -m "feat: render paired PDF translation pages"
```

---

### 任务 3：接入工作台、单主滚动 CSS 和浏览器验收

**文件：**
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 删除：`web-translate-plugin/src/pdf/sync-controller.ts`
- 删除：`web-translate-plugin/tests/unit/pdf/sync-controller.test.ts`

**接口：**
- 消费：任务 2 的 `PairedPageViewer`。
- 删除：`leftRef`、`rightRef`、`SyncController`、滚动意图计时器、页高恢复和双栏事件处理。
- 保持：翻译调度、缓存、失败重试、智能体和工具栏回调。

- [ ] **步骤 1：先更新 E2E 断言表达单主滚动契约**

新增或替换断言：

```ts
await expect(pdfPage.locator('.page-pair')).toHaveCount(2);
await expect(pdfPage.locator('.pdf-column')).toHaveCount(0);
await expect(pdfPage.locator('.translation-column')).toHaveCount(0);
expect(await pdfPage.locator('body').evaluate((el) => getComputedStyle(el).overflowY)).not.toBe('hidden');
expect(await pdfPage.locator('.reading-stream').evaluate((el) => getComputedStyle(el).overflowY)).not.toBe('auto');
```

比较每页 `.page-pair-pdf` 与 `.translation-page` 高度相等；验证第一页长译文正文 `scrollHeight > clientHeight` 且可修改 `scrollTop`；滚动页面后第二页进入视口。

- [ ] **步骤 2：运行 E2E 并确认旧布局失败**

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts --grep "公共 PDF"`

预期：失败，因为旧 DOM 仍包含独立列和两个列表滚动。

- [ ] **步骤 3：重构 `PdfWorkspace` 接入配对流**

工作区改为：

```tsx
<div className={`workspace-content ${agentOpen ? 'agent-open' : 'agent-collapsed'}`}>
  <section className="reading-stream">
    {source && pdfBytes
      ? <PairedPageViewer {...pairedViewerProps} bytes={pdfBytes} />
      : <p role="status">正在读取 PDF</p>}
  </section>
  <AgentPanel {...agentPanelProps} />
</div>
```

`navigateToPage` 只更新 `navigationPage` 和当前页，不调用同步控制器。删除 `PdfPane` 与所有双栏滚动事件。

- [ ] **步骤 4：重写布局 CSS**

关键规则：

```css
body { margin: 0; overflow-y: auto; }
.pdf-workspace { min-height: 100vh; }
.workspace-toolbar { position: sticky; top: 0; z-index: 20; }
.workspace-content { display: grid; grid-template-columns: minmax(0, 1fr) 320px; }
.reading-stream { min-width: 0; overflow: visible; }
.page-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .72fr); }
.translation-page-body { overflow-y: auto; overscroll-behavior-y: auto; }
.agent-panel { position: sticky; top: var(--workspace-sticky-offset); max-height: calc(100vh - var(--workspace-sticky-offset)); overflow: auto; }
```

窄屏页对改为单列；不得产生横向页面滚动。

- [ ] **步骤 5：删除同步模块并运行定向单元测试**

运行：

`npx vitest run tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/paired-page-viewer.test.tsx tests/unit/pdf/visible-page.test.ts`

预期：全部通过。运行 `rg -n "SyncController|workspace-columns|pdf-column|translation-column" web-translate-plugin/src`，预期无旧同步逻辑匹配。

- [ ] **步骤 6：运行 PDF 工作台 E2E**

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts`

预期：公共 PDF、失败诊断、Canvas 稳定和认证上传用例全部通过。

- [ ] **步骤 7：运行最终门禁**

运行：`npm run check`

预期：类型检查、普通单元测试和 Chrome MV3 构建通过；在线 arXiv 验收不会被重复执行。

- [ ] **步骤 8：提交工作台集成**

```powershell
git add web-translate-plugin/src/pdf/PdfWorkspace.tsx web-translate-plugin/entrypoints/pdf-workspace.content/style.css web-translate-plugin/tests/e2e/pdf-workspace.spec.ts web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx
git add -u web-translate-plugin/src/pdf/sync-controller.ts web-translate-plugin/tests/unit/pdf/sync-controller.test.ts
git commit -m "feat: use a single-scroll PDF reading stream"
```

- [ ] **步骤 9：核对工作树与凭据隔离**

运行：`git status --short` 和 `git status --ignored --short web-translate-plugin/.llm-experiment.local.json web-translate-plugin/.mineru-experiment.local.json`。

预期：跟踪工作树干净；两个凭据文件均显示为 `!!`。
