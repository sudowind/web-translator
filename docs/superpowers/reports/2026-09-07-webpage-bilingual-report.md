# 网页语义块对照翻译实施报告

## 实现范围

- 将原来的逐文本节点替换改为语义块对照；覆盖标题、段落、列表项、引用和通用容器连续文本，嵌套块不重复。
- 原文 DOM 和事件保留，译文紧跟原文；复制受限文字样式，安全重建加粗、斜体、链接与行内代码。
- 网页专用标记提示与 PDF 提示分离，后端消息仍为文本块，不接收或渲染模型 HTML。
- 新增、文本修改、元素替换、移动、删除、主题变化与 body 替换均协调更新；迟到结果丢弃；关闭移除全部自有节点并取消请求。
- 失败段显示本地重试按钮；超长段保留原文并明确提示。语种沿用用户设置。

## 开发验证

- `npm test -- tests/unit/webpage tests/unit/providers/openai/client.test.ts`：9 文件、63 项通过，5.80 秒。
- `npm run typecheck`：通过。
- `npm run build`：通过，最近一次 WXT 构建 2.885 秒。
- `npm run test:e2e -- webpage-translation.spec.ts`：2 项通过，6.0 秒；验证计算样式、主题切换不重译、嵌套列表、原始链接事件、译文链接跳转、动态更新及关闭清理。
- 已查看浏览器截图，原文与译文逐块上下对应，没有重复列表编号。

## 独立复核

一次只读审查发现主题变更未覆盖 html/data 属性的 P2。修复为观察 documentElement，纯样式与安全链接变化在本地更新，不重复请求模型；新增 class/data-theme 回归，同一 reviewer 已关闭原问题。

同时消除每个批次响应无条件全页扫描；仅存在真实待处理 mutation 时同步协调。剩余 Minor：动态变化仍按页面整体协调，超大动态站点的局部扫描优化留待后续性能数据支持。

## 验收边界

浏览器测试使用隔离配置、模拟 Provider 与授权后注入路径，未测试用户真实付费 Provider，也不代表真实 action Popup、activeTab 或原生权限门禁。人工验收需在固定目录加载的原扩展上重新加载，刷新目标网页，检查实际译文质量与站点适配。

本轮不进入 iframe、Shadow DOM 或 Canvas 内部；不复制表单控件。单块超过 10,000 字符时不拆散语义块，显示超长提示。

## release 最终门禁

- 功能提交：`dddef25`；普通合并后的代码验收基线：`153f99b`。
- `npm run check`：通过；74 个文件、512 项测试通过。总耗时 25.27 秒，其中 Vitest 16.09 秒、WXT 构建 2.898 秒；类型检查及生产产物权限检查均通过。
- `npm run test:e2e -- webpage-translation.spec.ts`：固定 release 生产构建上 2 项通过，6.1 秒。
- 固定构建目录：`D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3`。主工作区保持 release。
- 尝试通过 computer-use 访问 Chrome 重载原扩展时，工具返回 `Computer Use app approval timed out`；未执行重载。请用户在扩展管理页重载原扩展后刷新网页，人工验收真实 Provider 与 action Popup。
- 本次仅本地集成，未推送、未创建 PR、未删除工作区或分支。本文及计划的后续记录提交不改变已验证代码，按仓库约定不重复全量命令。
