# PDF 可见页清晰度补全报告

日期：2026-09-04
状态：开发验证完成，等待 release 集成门禁

## 问题与修复

原修复已解决旧帧放大与半成品显示，但没有覆盖全部清晰度路径：实际可见相邻页可能停在预览质量，最终 2 倍上限会低于高 DPR；残留 max-width/height:auto 强制规则破坏精确尺寸；DPR 监听只依赖 resize。原 E2E 仅要求位图密度至少 1，无法检出这些问题。

本轮实际可见 PDF 页全部提升最终质量，目标 max(DPR, 1.5)、上限 4；仍限制活动页前后 2 页、8 Mi 像素预算及 2 个并发任务。Canvas 显式指定宽高，整数位图分别精确映射横纵尺寸；分辨率媒体查询变化重新订阅。没有添加锐化滤镜或叠加可见文本。

## 开发验证

- TDD：原逻辑在 DPR 1、1.25、3 三个新增用例失败，证明采样策略缺口。
- 定向命令：`npm run test -- tests/unit/pdf/page-layout.test.ts tests/unit/pdf/pdf-page-canvas.test.tsx tests/unit/pdf/paired-page-loading.test.tsx tests/unit/pdf/pdf-render-queue.test.ts`，4 文件 / 26 项通过；耗时 27.02 秒，测试本身 924 ms，主要开销为 jsdom 环境与依赖加载。
- `npm run typecheck` 通过；dev 独立 `npm run build` 通过，WXT 5.215 秒。未覆盖验收插件目录。
- 新增浏览器清晰度用例 `npm run test:e2e -- --grep 非整数缩放` 通过，5.2 秒。四档 DPR 1/1.25/2/3、1.1 倍非整数缩放、两页同时可见、精确 CSS 宽高、无隐式 transform 均通过。
- 测试调试记录：最初使用未注册样本路由导致 PDF_NOT_ELIGIBLE，已改用现有公开样本；随后观察到 CDP 只改 density 不派发 resize/media change，诊断日志确认两种事件计数均为 0。浏览器测试改为同时轻微调整 viewport；无 resize 的媒体查询变化仍由组件测试独立覆盖，没有放宽密度断言。
- 一次独立只读复核无 Critical/Important；未重复全量命令。

## 交付边界

像素密度与几何通过不等同于用户真实论文的主观锐利度验收；扫描图像、源文件字体、夜间柔化仍会影响观感。未调用真实翻译接口。原窗口、队列和双缓冲上限不变，但低 DPR 最终帧增加到 1.5 倍采样，会增加有限绘制与显存开销，release 全量长文档门禁将确认回归。

开发归属本任务「优化翻译区布局宽度」（01a06771-7833-7e42-b81d-31d4f2eaa800）；开发路径 D:/Projects/web-translate-worktrees/dev；集成路径 D:/Projects/web-translate，保持 release。不回灌 release、不推送、不清除扩展数据。
