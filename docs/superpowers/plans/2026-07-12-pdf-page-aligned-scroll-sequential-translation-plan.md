# PDF 逐页等高滚动与顺序翻译实施计划

状态：已完成（2026-07-12，2026-07-23 回填）

> **供智能体执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施并在检查点复核。

**目标：** 让 PDF 与译文按页等高，长译文只在本页内部滚动，左右联动只响应用户意图，同时把整篇翻译改为从第一页开始的固定顺序。

**架构：** `PdfViewer` 上报真实页面高度，`TranslationPane` 用相同高度建立固定外层和页内滚动正文；`SyncController` 只接受显式用户驱动的外层可见页事件。`PageScheduler` 与阅读页彻底解耦，只按页码递增派发，并继续复用现有缓存、失败隔离和并发控制。

**技术栈：** TypeScript 7、React 19、WXT 0.20、Chrome MV3、PDF.js、Vitest 4、Playwright 1.61、CSS Grid。

## 全局约束

- 所有规格、计划、测试名称和新增用户文案使用中文；API 名称与代码标识符可以保留英文。
- 地址栏 PDF URL 必须逐字不变，PDF 仍由 PDF.js 重渲染。
- 翻译并发数保持为 `2`，请求派发顺序固定为 `1, 2, 3...`，不受阅读页影响。
- 译文回填、尺寸观察和程序化滚动不得驱动左右联动。
- 不修改 MinerU 协议、LLM Prompt、翻译缓存键和智能体上下文策略。
- 开发阶段只运行受影响的定向测试；全部实现完成后只运行一次 `npm run check` 和一次相关 CfT/Playwright E2E。

---

## 文件结构

- 修改 `web-translate-plugin/src/translation/page-scheduler.ts`：实现固定页码顺序和失败页重试。
- 修改 `web-translate-plugin/src/pdf/sync-controller.ts`：实现用户意图驱动的外层同步。
- 创建 `web-translate-plugin/src/pdf/page-wheel.ts`：判断页内滚动是否应停留本页或跨页。
- 修改 `web-translate-plugin/src/pdf/PdfViewer.tsx`：上报每个 PDF 页槽的实际高度。
- 修改 `web-translate-plugin/src/pdf/TranslationPane.tsx`：建立等高译文页和页内滚动正文。
- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`：连接尺寸、滚动意图、跨页导航和顺序调度。
- 修改 `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`：固定页高、页内滚动条和滚动边界样式。
- 修改相关 Vitest 与 Playwright 文件：覆盖调度、同步、页内边界、等高和滚动稳定性。

---

### 任务 1：翻译调度改为固定顺序

**文件：**

- 修改：`web-translate-plugin/tests/unit/translation/page-scheduler.test.ts`
- 修改：`web-translate-plugin/src/translation/page-scheduler.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`

**接口：**

- 保留：`new PageScheduler(pageCount: number, concurrency?: number)`
- 保留：`take(): number | null`、`markDone(page)`、`markFailed(page)`、`retry(page)`
- 删除：`setActivePage(page)`；阅读页不再进入调度器。

- [x] **步骤 1：先写固定顺序的失败测试**

```ts
it('阅读页变化不参与调度并按页码顺序派发', () => {
  const scheduler = new PageScheduler(5, 2);
  expect([scheduler.take(), scheduler.take(), scheduler.take()]).toEqual([1, 2, null]);
  scheduler.markDone(2);
  expect(scheduler.take()).toBe(3);
  scheduler.markDone(1);
  expect(scheduler.take()).toBe(4);
});

it('失败页不阻塞后续页且只允许失败页重试', () => {
  const scheduler = new PageScheduler(4, 1);
  expect(scheduler.take()).toBe(1);
  scheduler.markFailed(1);
  expect(scheduler.take()).toBe(2);
  scheduler.retry(1);
  scheduler.markDone(2);
  expect(scheduler.take()).toBe(1);
});
```

- [x] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/translation/page-scheduler.test.ts`  
预期：旧实现仍暴露 `setActivePage` 距离排序，断言中的固定顺序失败。

- [x] **步骤 3：实现最小固定顺序调度器**

```ts
export class PageScheduler {
  private readonly done = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly inFlight = new Set<number>();
  private readonly retryQueue: number[] = [];

  take(): number | null {
    if (this.inFlight.size >= this.concurrency) return null;
    const retry = this.retryQueue.shift();
    const page = retry ?? Array.from({ length: this.pageCount }, (_, index) => index + 1)
      .find((candidate) => !this.done.has(candidate) && !this.failed.has(candidate) && !this.inFlight.has(candidate));
    if (page === undefined) return null;
    this.inFlight.add(page);
    return page;
  }

  retry(page: number): void {
    if (!this.failed.delete(page) || this.retryQueue.includes(page)) return;
    this.retryQueue.push(page);
  }
}
```

保留构造参数校验以及 `markDone`、`markFailed` 对集合的正确清理。在 `PdfWorkspace` 中删除创建调度器和 `activePage` effect 内的两处 `setActivePage` 调用；当前页状态继续供工具栏、同步和智能体使用。

- [x] **步骤 4：运行绿灯测试**

运行：`npm test -- tests/unit/translation/page-scheduler.test.ts`  
预期：该文件全部通过。

- [x] **步骤 5：提交任务 1**

```powershell
git add web-translate-plugin/src/translation/page-scheduler.ts web-translate-plugin/src/pdf/PdfWorkspace.tsx web-translate-plugin/tests/unit/translation/page-scheduler.test.ts
git commit -m "feat: translate PDF pages sequentially"
```

---

### 任务 2：同步控制器只响应用户外层滚动

**文件：**

- 修改：`web-translate-plugin/tests/unit/pdf/sync-controller.test.ts`
- 修改：`web-translate-plugin/src/pdf/sync-controller.ts`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`

**接口：**

- 新增：`beginUserScroll(pane: PdfPane): void`
- 新增：`endUserScroll(pane: PdfPane): void`
- 保留：`onVisible(source, page, progress)`、`navigateToPage(page)`
- 删除：`suspend`、`release`、`userScroll`、`resync` 的旧集合语义。

- [x] **步骤 1：先写用户意图边界的失败测试**

```ts
it('没有用户意图时忽略内容回填产生的可见页变化', () => {
  const navigate = vi.fn();
  const controller = new SyncController(navigate);
  controller.onVisible('translation', 4, 0.8);
  expect(navigate).not.toHaveBeenCalled();
});

it('只允许当前用户驱动栏同步另一栏', () => {
  const navigate = vi.fn();
  const controller = new SyncController(navigate);
  controller.beginUserScroll('pdf');
  controller.onVisible('pdf', 3, 0.4);
  controller.onVisible('translation', 3, 0.4);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('translation', 3, 0.4);
  controller.endUserScroll('pdf');
  controller.onVisible('pdf', 4, 0.1);
  expect(navigate).toHaveBeenCalledTimes(1);
});
```

- [x] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/pdf/sync-controller.test.ts`  
预期：旧控制器在没有用户意图时仍调用 `navigate`，测试失败。

- [x] **步骤 3：实现用户驱动栏状态**

```ts
export class SyncController {
  private driver: PdfPane | null = null;

  beginUserScroll(pane: PdfPane): void {
    this.driver = pane;
  }

  endUserScroll(pane: PdfPane): void {
    if (this.driver === pane) this.driver = null;
  }

  onVisible(source: PdfPane, page: number, progress = 0): void {
    if (this.driver !== source) return;
    this.navigate(source === 'pdf' ? 'translation' : 'pdf', page, clamp(progress));
  }

  navigateToPage(page: number): void {
    this.driver = null;
    this.navigate('pdf', page, 0);
    this.navigate('translation', page, 0);
  }
}
```

在 `PdfWorkspace` 中为左右外层容器增加滚轮、触摸、指针和键盘意图入口；使用一个 `180ms` 的可重置定时器调用 `endUserScroll`。不要在普通 `scroll` 事件中登记用户意图，因为程序化滚动和内容回填也会产生该事件。

- [x] **步骤 4：运行绿灯测试**

运行：`npm test -- tests/unit/pdf/sync-controller.test.ts`  
预期：该文件全部通过。

- [x] **步骤 5：提交任务 2**

```powershell
git add web-translate-plugin/src/pdf/sync-controller.ts web-translate-plugin/src/pdf/PdfWorkspace.tsx web-translate-plugin/tests/unit/pdf/sync-controller.test.ts
git commit -m "fix: sync PDF panes only from user scroll"
```

---

### 任务 3：建立逐页等高和页内滚动

**文件：**

- 创建：`web-translate-plugin/src/pdf/page-wheel.ts`
- 创建：`web-translate-plugin/tests/unit/pdf/page-wheel.test.ts`
- 修改：`web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`

**接口：**

- `PdfViewer` 新增 `onPageHeightsChange(heights: ReadonlyMap<number, number>): void`
- `TranslationPane` 新增 `pageHeights: ReadonlyMap<number, number>` 与 `onPageBoundary(page: number, direction: -1 | 1): void`
- 新增 `pageWheelAction(metrics, deltaY): 'inner' | 'previous' | 'next'`

- [x] **步骤 1：先写页内滚动边界失败测试**

```ts
expect(pageWheelAction({ scrollTop: 40, clientHeight: 300, scrollHeight: 900 }, 100)).toBe('inner');
expect(pageWheelAction({ scrollTop: 600, clientHeight: 300, scrollHeight: 900 }, 100)).toBe('next');
expect(pageWheelAction({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 }, -100)).toBe('previous');
```

同时在组件静态渲染测试中传入 `new Map([[1, 640], [2, 820]])`，断言存在：

```ts
expect(html).toContain('class="translation-page"');
expect(html).toContain('style="height:640px"');
expect(html).toContain('class="translation-page-body"');
```

- [x] **步骤 2：运行红灯测试**

运行：`npm test -- tests/unit/pdf/page-wheel.test.ts tests/unit/pdf/workspace-components.test.tsx`  
预期：`page-wheel` 模块不存在，`TranslationPane` 也没有页高和正文容器。

- [x] **步骤 3：实现边界判断和译文页结构**

```ts
export function pageWheelAction(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  deltaY: number,
): 'inner' | 'previous' | 'next' {
  if (deltaY < 0 && metrics.scrollTop <= 1) return 'previous';
  if (deltaY > 0 && metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1) return 'next';
  return 'inner';
}
```

每个译文页输出固定结构：

```tsx
<section className="translation-page" style={{ height: pageHeights.get(number) ?? 780 }}>
  <header>...</header>
  <div className="translation-page-body" onWheel={(event) => handlePageWheel(event, number)}>
    {renderBlocks(page)}
  </div>
</section>
```

正文未到边界时 `stopPropagation()`，继续原生页内滚动；到达边界时 `preventDefault()`、`stopPropagation()` 并调用 `onPageBoundary`。工作台把目标页限制在 `1..pageCount`，然后复用 `navigateToPage` 同时定位两栏。

`translation-page-body` 的指针和触摸起始事件必须停止向右侧外层传播，避免页内阅读被登记成外层联动意图。`ArrowUp`、`ArrowDown`、`PageUp`、`PageDown` 和触摸滑动统一换算为正负滚动方向并复用 `pageWheelAction`；只有到达页内上下边界才调用 `onPageBoundary`，从而满足键盘和触摸设备没有滚动陷阱的要求。

- [x] **步骤 4：让 PDF 页面上报真实高度**

在 `PdfViewer` 中用一个 `ResizeObserver` 观察所有 `[data-pdf-page]`，按 `data-pdf-page` 生成 `Map<number, number>`；高度取 `entry.borderBoxSize` 或 `getBoundingClientRect().height`，只有映射变化时才调用 `onPageHeightsChange`。卸载和页数变化时必须 `disconnect()`。

`PdfWorkspace` 保存页高映射。更新映射前记录右侧外层 `scrollTop`，React 提交布局后恢复同一绝对值，避免尺寸校准把用户拉向底部。

- [x] **步骤 5：加入固定页高和双滚动层 CSS**

```css
.translation-page {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  margin-bottom: 16px;
  padding: 20px;
  overflow: hidden;
}

.translation-page-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
}
```

移除旧 `.translation-pages > section { min-height: 70vh; ... }` 中依赖内容高度的规则，保留边框、圆角和背景。

- [x] **步骤 6：运行绿灯测试**

运行：`npm test -- tests/unit/pdf/page-wheel.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/sync-controller.test.ts`  
预期：三个文件全部通过。

- [x] **步骤 7：提交任务 3**

```powershell
git add web-translate-plugin/src/pdf web-translate-plugin/tests/unit/pdf web-translate-plugin/entrypoints/pdf-workspace.content/style.css
git commit -m "feat: align PDF pages with scrollable translations"
```

---

### 任务 4：CfT 回归与最终门禁

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`

**接口：** 不新增生产接口；只扩展真实浏览器验收。

- [x] **步骤 1：先增强 E2E fixture 和失败断言**

让第 1 页返回足够长的译文以产生内部滚动，并记录翻译请求派发页码。新增断言：

```ts
await expect.poll(() => observed.translationPages.length).toBeGreaterThanOrEqual(2);
expect(observed.translationPages.slice(0, 2)).toEqual([1, 2]);

const pdfHeight = await pdfPage.locator('[data-pdf-page="1"]').evaluate((node) => node.getBoundingClientRect().height);
const translationHeight = await pdfPage.locator('[data-translation-page="1"]').evaluate((node) => node.getBoundingClientRect().height);
expect(Math.abs(pdfHeight - translationHeight)).toBeLessThanOrEqual(1);

const body = pdfPage.locator('[data-translation-page="1"] .translation-page-body');
expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
```

记录译文外层 `scrollTop`，等待后续页面翻译完成，再断言它没有因为回填跳到底部。把页内正文滚到底后派发向下滚轮，断言左右两栏进入第 2 页。

- [x] **步骤 2：在旧构建上运行红灯 E2E**

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts --grep "公开 PDF"`  
预期：旧实现优先翻译 `#page=2`，且译文页不等高、没有页内滚动，至少一个新断言失败。

- [x] **步骤 3：构建并运行完整 PDF E2E**

运行：`npm run build`  
预期：生产扩展构建成功并包含 `pdf-workspace.css`。

运行：`npx playwright test tests/e2e/pdf-workspace.spec.ts`  
预期：公开 PDF 与认证 PDF 共 2 条测试通过。

- [x] **步骤 4：运行最终完整门禁**

运行：`npm run check`  
预期：类型检查、全部 Vitest 和生产构建均以退出码 `0` 完成。

- [x] **步骤 5：复核与提交**

检查：`git diff --check`、`git status --short`，确认没有测试产物或无关文件进入提交。

```powershell
git add web-translate-plugin/tests/e2e/pdf-workspace.spec.ts
git commit -m "test: cover PDF page-aligned scrolling"
```

最终报告必须列出 CfT/Playwright 用例数量、Vitest 测试数量、构建结果和提交哈希，并提醒用户在 `chrome://extensions` 重新加载扩展。
