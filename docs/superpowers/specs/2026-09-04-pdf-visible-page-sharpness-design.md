# PDF 可见页清晰度补全

日期：2026-09-04
状态：已实现，release 自动化门禁通过；真实论文观感待人工验收

## 诊断

原实现将缩放防抖后按 DPR、最高 2 倍及 8 Mi 像素预算双缓冲渲染，已解决半成品帧和放大旧帧，但门禁仅验证密度至少为 1。剩余缺口：高清仅覆盖主导页；高 DPR 被 2 倍截断；CSS max-width 与 height:auto!important 改变显示尺寸；DPR 仅监听 resize。低 DPR 的 1 倍渲染也缺少小字号采样余量。

## 方案

- 观察实际 PDF 槽位，扣除工具栏；可见页全部升级最终质量。仍限定活动页前后 2 页窗口，保留已升级帧直到离开窗口。
- 最终目标密度 max(DPR, 1.5)，上限 4；预览保持 1.25/1 上限。保留 8 Mi 像素预算及最多 2 个任务；极大 CSS 页面至少 1 倍。不承诺扫描件恢复细节或无限放大。
- 整数位图宽高分别映射到精确 CSS 宽高，PDF.js transform 使用 bitmapWidth/cssWidth 与 bitmapHeight/cssHeight。文本与高亮仍消费显示 viewport。
- 移除隐式 Canvas 尺寸 CSS；已提交帧指定宽高，仅缩小时按等比显式缩小旧帧，放大保持旧尺寸至换帧。
- DPR 监听 resize 与 matchMedia resolution，变化后重新订阅；不变 DPR 不重绘。
- 不使用锐化滤镜或重复叠加可见文本。release 夜间原稿柔化属于色彩处理，合并保留。

## 验收

覆盖非整数缩放、DPR 1/1.25/2/3、可见相邻页升级、分辨率变化、采样余量、预算与取消。浏览器验证密度与显式宽高，继续长文档性能门禁。

在 D:/Projects/web-translate-worktrees/dev 开发提交，再普通 merge 入主工作区 release；保留数据库 v5，不复制 dev 产物、不清空插件。最终在 release 候选运行 check/E2E，用户重载原扩展验收。

资料：[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)、[MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)，2026-09-04 核对。
