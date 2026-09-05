# PDF 紧凑对译布局与缩放清晰度实施报告

日期：2026-09-03  
分支：`dev`  
状态：已完成

## 完成内容

- 新增容器驱动的页对布局算法，根据 PDF 基础页宽、请求缩放和 `.reading-stream` 实际宽度计算双列或上下布局。
- 双列模式把 PDF 可见右边缘与译文可见左边缘固定在 12–20px，并把译文限制为 480–720px；页对整体在阅读区居中。
- 智能体侧栏通过压缩实际阅读区自然参与布局决策；空间不足时页对切换为 PDF→译文上下排列。
- 新增 48px 布局滞回，降低临界宽度附近的模式抖动。
- 缩放采用 120ms 稳定提交和 220ms 最大等待，并在布局变化前后恢复当前页相对阅读进度。
- Canvas、文本层、高亮层和页高共享统一显示度量，删除最终帧依赖 CSS 隐式放大的路径。
- Canvas 按设备像素比渲染，最终质量单页使用约 8 Mi 像素预算，输出倍率限制为 1–2。
- 使用两个 Canvas 缓冲区：后台帧完整渲染后才原子切换到前台，失败或取消时保留上一张完整帧。
- 当前页、相邻页和窗口边缘页分别使用最高 2×、1.25×、1× 质量上限；已完成的高质量帧不会因为页面降为相邻页而重复降级渲染。
- 新增全局优先级队列，PDF.js 同时最多运行两个渲染任务，当前可见页优先于相邻页和空闲预览页。
- 更新 2560×1271、180%、智能体收起/展开以及既有响应式视觉基线。

## 主要文件

- `web-translate-plugin/src/pdf/page-layout.ts`
- `web-translate-plugin/src/pdf/pdf-render-queue.ts`
- `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- `web-translate-plugin/src/pdf/PdfViewer.tsx`
- `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- `web-translate-plugin/tests/unit/pdf/page-layout.test.ts`
- `web-translate-plugin/tests/unit/pdf/pdf-render-queue.test.ts`
- `web-translate-plugin/tests/unit/pdf/pdf-page-canvas.test.tsx`
- `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`

## 视觉与结构验收

Playwright 对 2560×1271、180% 场景执行以下结构断言：

- 页对为双列模式；
- 原文与译文可见中缝为 12–20px；
- 译文宽度不超过 720px；
- 页对在阅读区左右留白差不超过 2px；
- 智能体展开后页对不与侧栏重叠；
- 页面水平溢出不超过 1px；
- Canvas 位图密度不低于 1；
- 缩放后当前页锚点偏差不超过 8px。

新增并人工检查：

- `compact-reading-2560-180-win32.png`
- `compact-reading-2560-180-agent-open-win32.png`

截图显示 PDF 与译文之间的隐藏轨道空白已经消失，译文不再顶到最右端；侧栏展开后阅读区仍保持紧凑双列。1440px 侧栏场景在空间不足时按设计切换为上下布局。

## 自动化验证

### 完整发布门禁

命令：`npm run check`

结果：通过。

- TypeScript：通过；
- Vitest：60 个测试文件、364 条测试全部通过；
- WXT Chrome MV3 生产构建：通过；
- 产物校验：Unicode noncharacter=0、静态 host 权限=0、静态 content script=0。

### PDF 工作台 E2E

命令：`npm run test:e2e -- pdf-workspace.spec.ts`

结果：4 个场景通过，1 个真实 arXiv 一次性网络门禁按环境变量规则跳过。

通过场景包括：

- 公开 PDF 的解析、翻译、紧凑布局、180% 缩放、智能体、区块联动与恢复；
- 76 页长文档按需翻译、页面窗口、模式切换与缓存恢复；
- 翻译失败诊断和自动重试；
- 认证 PDF 上传同意边界。

76 页基准：

- `mountedTranslationBodies = 5`；
- `initialProviderPages = 4`；
- `firstReadableMs = 1404`；
- `maxFrameIntervalMs = 13.9`；
- `heapDeltaBytes = 17,787,378`；
- `maxRenderToCommitMs = 100`。

真实 arXiv 用例只在 `PDF_ARXIV_FEASIBILITY=1` 时运行，继续遵守项目中“一次性真实浏览器源读取门禁”的既有约束，本轮没有重复触发外网可行性验证。

## 已知边界

- 主阅读区继续不提供横向无限画布；请求比例超过可用宽度时按阅读区宽度适配。
- 双缓冲会在换帧期间短暂同时持有前后台 Canvas，但像素分配发生在获得渲染队列槽位之后，且换帧后立即清空旧缓冲区。
- 已访问当前页的高质量帧在仍处于前后 2 页窗口内时保留，离开窗口后按现有资源生命周期释放。
