# PDF 紧凑对译布局与缩放清晰度实施计划

日期：2026-09-03  
状态：已完成

## 目标

实现 `docs/superpowers/specs/2026-09-03-pdf-compact-reading-layout-canvas-clarity-design.md`，消除宽屏下 PDF 与译文之间的无效空白，限制译文行长，让智能体侧栏参与真实容器宽度决策，并通过统一显示度量、双缓冲和渲染预算解决缩放模糊问题。

## 全局约束

- 所有规格、计划和实施报告使用中文。
- 先合入当前 PDF 长文档性能工作树，或在实现前确认其改动已稳定；不得覆盖 `PairedPageViewer.tsx`、`PdfViewer.tsx` 和 `PdfTextLayer.tsx` 中已有的按需资源生命周期改动。
- 同一共享工作树只运行一个实现任务；独立 reviewer 只读审查。
- 每个里程碑使用定向 TDD，里程碑结束前不重复运行完整 `npm run check` 或 PDF E2E。
- 布局计算以 `.reading-stream` 容器宽度为准，不新增只对 2560px/180% 生效的特例。
- 清晰度优化不得取消活动页窗口、离屏 cleanup、页面代理缓存和译文虚拟化。
- 不用降低断言、扩大 Canvas 常驻窗口或把全部页面预渲染来换取截图效果。

## 里程碑 1：布局与显示度量纯逻辑

### 公开接口

- `ReadingLayoutMode = 'paired' | 'stacked'`
- `computeReadingLayout(input)`
- `applyLayoutHysteresis(previousMode, candidate, availableWidth)`
- `computePageDisplayMetrics(input)`
- `shouldRerenderPage(previousMetrics, nextMetrics)`

### 文件

- 新增 `web-translate-plugin/src/pdf/page-layout.ts`
- 新增 `web-translate-plugin/tests/unit/pdf/page-layout.test.ts`

### 验收

- 50%、110%、180%、300% 和多种容器宽度下宽度分配符合规格。
- 双列中缝固定为 12–20px，译文为 480–720px，页对整体居中。
- 智能体只通过改变真实容器宽度影响算法，无额外重复分支。
- 空间不足时进入上下布局，48px 滞回区不会抖动。
- CSS 尺寸、位图尺寸、DPR 和 8 Mi 像素预算计算可确定测试。

## 里程碑 2：紧凑页对与容器响应

### 文件

- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改 `web-translate-plugin/tests/unit/pdf/paired-page-viewer.test.tsx`
- 修改 `web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`

### 实现要求

- 用 `ResizeObserver` 读取 `.reading-stream` 的稳定宽度并消费纯逻辑结果。
- 页对使用明确的 PDF 宽度、译文宽度和书脊宽度；移除 `1fr/.72fr` 造成的隐藏 PDF 轨道留白。
- 页对整体 shrink-to-content 后居中，译文最大 720px。
- 以容器计算结果切换双列/上下，不把智能体开关写成另一套宽度规则。
- 保持 76 页轻量页面壳、`content-visibility`、逐页等高和译文窗口不变。

### 验收

- 2560px/180% 下中间可见空白等于书脊宽度。
- 侧栏收起和展开后布局结果均符合纯逻辑输出。
- 上下模式 DOM 顺序为 PDF→译文，无横向溢出。
- 只改变外侧留白时不触发 Canvas 重绘。

## 里程碑 3：滚动锚点与缩放提交

### 文件

- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/WorkspaceToolbar.tsx`（仅在需要适配状态时）
- 修改相关 workspace/paired-page unit tests

### 实现要求

- 区分即时工具栏缩放值和 100–140ms 防抖后的渲染缩放值，设置 220ms 最大等待。
- 每次布局或缩放提交前后恢复当前页与页内进度。
- 布局受限时输出“已适配阅读区宽度”状态，不让工具栏比例与 CSS 偷缩放混淆。
- 过期缩放 generation 不提交页高或可见帧。

### 验收

- 连续点击缩放只提交最新 generation。
- 当前页锚点偏差不超过 8px。
- `prefers-reduced-motion` 下没有平滑滚动或尺寸动画。

## 里程碑 4：Canvas 双缓冲与原子换帧

### 公开接口

- 已提交帧模型：Canvas、显示 viewport、render id、显示度量。
- 后台帧生命周期：创建、完成、取消、失败、换帧和释放。

### 文件

- 修改 `web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/PdfTextLayer.tsx`
- 修改 `web-translate-plugin/src/pdf/PdfBlockHighlightLayer.tsx`（如需显式消费度量）
- 修改 `web-translate-plugin/tests/unit/pdf/pdf-page-canvas.test.tsx`
- 修改 `web-translate-plugin/tests/unit/pdf/pdf-layers.test.tsx`

### 实现要求

- PDF.js 只在后台 Canvas 上绘制；成功后原子替换前台帧。
- 可见 Canvas 不在新任务开始时清空。
- Canvas、文本层和高亮层使用同一已提交 viewport/render id。
- 放大等待时禁止旧帧 CSS 上采样；缩小时允许短暂下采样预览。
- 取消、失败和组件卸载时安全处理 render task、文本层和 `page.cleanup()` 顺序。

### 验收

- 测试能证明可见 Canvas 从未展示进行中的 render task。
- 快速缩放、取消和失败都保留最后完整帧。
- 旧帧释放后位图尺寸归零，无悬挂文本层。

## 里程碑 5：质量队列与性能预算

### 公开接口

- `PdfRenderPriority = 'visible-final' | 'near-preview' | 'idle-preview'`
- 最大 2 个最终质量任务的队列。
- 按页码、generation 和质量等级去重/取消。

### 文件

- 新增 `web-translate-plugin/src/pdf/pdf-render-queue.ts`
- 新增 `web-translate-plugin/tests/unit/pdf/pdf-render-queue.test.ts`
- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改现有 PDF 资源生命周期测试

### 验收

- 当前页优先最终质量，相邻页最高 1.25x，窗口边缘页空闲时才做 1x 预览。
- 最终质量并发不超过 2；旧 generation 和离窗任务会取消。
- 单个最终 Canvas 不超过 8 Mi 像素，`outputScale` 在 1–2 之间。
- 智能体流式增量和仅外侧留白变化不会创建 render task。
- 离屏 cleanup 与最多 5 页窗口继续通过。

## 里程碑 6：响应式与视觉 E2E

### 文件

- 修改 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 更新受影响的 PDF 工作台截图基线
- 在 `docs/superpowers/reports/` 新增本功能实施报告

### 场景

- 2560×1271、180%、侧栏收起/展开。
- 1440×1000、110%、侧栏收起/展开。
- 1280×900、180%、侧栏展开。
- 800px、375px 窄屏。
- `deviceScaleFactor` 1 和 2。
- 快速缩放 110%→180%→120%，以及缩放中快速滚动/开关侧栏。

### 验收

- 双列中缝误差不超过 1px，译文不超过 720px，外侧留白对称误差不超过 2px。
- 所有场景无水平溢出，当前页锚点误差不超过 8px。
- 位图/CSS 尺寸比例与计算度量一致，不存在 CSS 放大低分辨率 Canvas。
- 截图人工复核没有半成品帧、明显模糊或文本层错位。
- 76 页基准的 Canvas 窗口、render 并发和内存结构上限不回退。

## 里程碑 7：独立复核、修复波次与最终门禁

- 独立 reviewer 只读审查布局算法、容器竞态、锚点恢复、Canvas 生命周期、PDF.js cleanup 和内存预算。
- 合并 Critical/Important 为一个 fix wave，补回归测试并只跑定向测试。
- 由同一 reviewer 聚焦复核关闭原问题。
- 运行一次 `npm run check`。
- 运行一次 `npm run test:e2e -- pdf-workspace.spec.ts`。
- 在当前提交上记录命令、耗时、视觉证据、设备像素比和已知限制。
- 回填计划状态与实施报告；新鲜证据齐全后才能声明完成。
