# Dashboard 字号优化集成记录

日期：2026-09-04

## 本轮候选

- 功能负责人任务：`设计插件独立配置页面`，任务 ID `01a067a6-ce8c-72c2-b474-d62584941118`，hostId `local`。
- 来源分支：`codex/extension-dashboard`；来源提交：`2afc2bce6851ba916bb3b61839ce92577fea8a88`。
- release 合并前：`2a1ab0a`；普通非快进合并后的候选：`6e97f03354c1210576475a53d04cbb4c270865c8`。
- release 工作区及固定插件路径：`D:\Projects\web-translate`、`D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3`。
- 合并前两侧工作区干净；合并无文本冲突。集成后的两份实现文件及两份新增测试与功能提交一致，没有在 release 另改字号方案或业务功能。

## 职责与范围

由 Dashboard 开发任务负责字号问题分析、设计、实现和定向功能验证。本会话只接收提交、合并、独立集成复核和最终门禁。未改权限、数据库、Provider、翻译或 PDF 逻辑；未推送远端。

功能摘要以开发任务报告为准：默认正文、标签和按钮 16px，辅助信息 14px，历史和分组标题 18px，页面标题 40px（窄屏 32px）；相对字号、中文字体回退、长文字换行、进度说明正常排版，以及窄屏表单和导航重排。

## 独立集成复核

一次只读独立复核完成，无 Critical / Important 集成问题。release 独有输出模式、能力探测和保存逻辑均保留。

以下 Minor 为测试覆盖边界，并非已确认功能缺陷，不触发 release 功能修改：

- 新增 E2E 未预置能力验证成功记录或真实 Provider 错误，因此不能证明全部较长能力反馈都已覆盖。
- 原生 select/option 的内部内容裁切没有被布局断言覆盖，窄屏放大时选中文本能否完整显示仍需人工确认。

## 最终自动化验证

候选 `6e97f03` 上的新鲜验证结果：

- `npm run check` 通过：TypeScript、72 个测试文件 / 486 项单测、生产构建及产物检查。
- Vitest 28.11 秒（transform 3.04 秒、setup 2.56 秒、import 累计 12.37 秒、tests 5.33 秒、environment 累计 64.57 秒；累计项并非墙钟总时长）。WXT 构建 3.658 秒。
- 产物检查通过：Unicode noncharacter=0、静态 host 权限=0、静态 content script=0、options 独立标签页=1。
- `npm run test:e2e -- dashboard-typography.spec.ts webpage-translation.spec.ts`：11 项全部通过，16.9 秒，无跳过，无快照更新。
- 已检查 release 自身生成的桌面 AI 服务及 375px / 200% 文本缩放的翻译偏好截图；原有输出能力设置仍在。后一截图原生下拉框的长选中文本显示不完整，对应上述覆盖边界，记录为窄屏可读性限制，未在 release 改功能。
- release 截图目录为 `web-translate-plugin/test-results/dashboard-typography-*`，属于生成产物，不提交 Git。未使用功能分支的旧数据库构建覆盖主目录。
- 门禁之后只补本集成记录，不修改实现或测试；验证证据仍对应同一候选代码。

本轮不重复无关 PDF E2E；上轮记录的长文档快速滚动窗口非稳定失败仍未关闭，不因本轮检查通过而视为修复。

## 人工验收

状态：待人工验收，不代表用户已验收通过。

构建后重载原主目录安装的扩展并刷新后台页面，不卸载、不清空配置。请查看五个分区的字号、说明文字、长历史标题，以及实际 Chrome 原生 100%/200% 缩放下的布局。真实 Provider 反馈、原生保存授权和现有配置保留由用户确认；自动化不读取用户凭据、不操作用户现有扩展。

新增 E2E 的 200% 是根字号文本缩放，不是 Chrome 原生页面缩放，不能互相替代。若验收发现问题，回派 Dashboard 任务，在原分支修复后再合入 release。
