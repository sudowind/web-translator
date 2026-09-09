# 论文库首版实施与验收报告

日期：2026-09-09。状态：开发与自动验证完成，待用户重载原扩展并人工验收，未推送或发布。

## 分支与负责人

- 当前任务：01a08551-2b12-74f2-9d2a-5fd24c3920e4（local）。
- 功能分支 codex/paper-library，从 fetch 后 origin/master 0878ca1 创建；独立工作区 D:\Projects\web-translate\.superpowers\worktrees\paper-library。
- 功能提交 a3edb48；主目录原处于 release 周期，始终保留 release。集成前已核对另一开发任务完成、主目录干净，最新集成基线为 9def565。
- 普通合并 21ac621；唯一冲突是 PDF 标题，保留 release 的 displayTitle，同时传给收藏弹窗。465d541 补该交叉点的真实 E2E。
- 验证候选 e9bda5f；相对 465d541 仅更新 7 张工具栏截图基线，生产源码完全相同。本报告提交仅增加文档，不改变已验证代码和产物。

## 首版功能

控制台新增论文库：文件夹嵌套、新建、重命名、确认删除子树；收藏名称编辑、移动目录、取消收藏、全库名称搜索与打开论文。PDF 工具栏星标和最近阅读 PDF 行提供收藏入口。收藏弹窗可新建目录并记住上次目录；已删除的默认目录回退未分类。一篇论文一个收藏位置，arXiv 摘要/PDF 标识去重且保留版本差别。

收藏存储独立于历史和缓存。删除目录只删除对应收藏，不删除阅读、解析或译文；清理历史/缓存保留收藏。无最新历史时打开无页码 URL，避免覆盖现有阅读恢复位置。没有增加标签、笔记、阅读状态、回收站或同步等扩展能力。

## 验证证据

- 功能开发定向：npx vitest run tests/unit/library tests/unit/storage/db-migration.test.ts tests/unit/settings/dashboard.test.tsx，13/13 通过；覆盖 v0/v2/v3/v4/v5 到 v6 的保留式迁移、子树删除、去重、默认目录与来源授权边界。
- 功能开发：npm run typecheck 与 npm run build 通过；独立 profile 的 paper-library.spec.ts 两用例通过（5.2 秒）。
- release 465d541：npm run check 通过，80 个测试文件、547 项测试通过，类型检查、生产构建、产物安全检查通过。Vitest 17.43 秒，WXT 3.46 秒；4 worker。日志 .superpowers/validation/paper-library/check.log。
- release 465d541：npm run test:e2e -- paper-library.spec.ts dashboard-typography.spec.ts pdf-workspace.spec.ts，18 通过、1 旧截图差异、1 原有环境开关跳过，总耗时约 1.2 分钟。耗时主要为真实 Chromium PDF 与多尺寸截图流程；其中 76 页用例 10 秒。已通过论文库两入口、嵌套与移动、改名与搜索、刷新持久化、清理隔离、删除、PDF 阅读恢复、官方标题与收藏名称联动、后台文字缩放与窄屏布局。
- 人工检查差异图与 7 张新截图：变化是新增星标及工具栏位置，正文和交互布局保留。仅更新视觉基线，没有放宽断言。更新模式下公开 PDF 全流程通过（24.4 秒）。
- release e9bda5f：npx playwright test pdf-workspace.spec.ts -g '公开 PDF 保持通用 URL'，正常截图断言下 1/1 通过（14 秒）。因此相关用例累计 19 通过，无待修复失败；保留 1 项原有 PDF_ARXIV_FEASIBILITY 环境门禁跳过。
- 后续只有截图与文档变化，完整 check 的代码证据仍适用，不重复运行全量命令。最终正常截图日志 .superpowers/validation/paper-library/final-visual.log。

## 独立复核

同一 reviewer 完成一次里程碑只读复核及聚焦复核。发现的 Important：旧收藏页码可能覆盖后续阅读恢复，已修正并补定向回归；目录缩进和存储说明两项 Minor 已关闭。集成冲突方案已聚焦复核，无未关闭 Critical/Important。

## 人工验收

验收产物：D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3。

1. 关闭旧控制台及正在运行的工作台，在 Chrome 扩展管理页面对原 Web Translate 点击重新加载，不卸载、不清空配置。
2. 打开管理后台，确认「论文库」；从最近阅读收藏一篇 PDF，修改名称并选择/新建目录。
3. 在论文库建立子目录、移动收藏、搜索名称、重新打开论文，确认阅读位置符合预期。
4. 在 PDF 工具栏点击星标，确认默认名称、目录记忆、已收藏编辑与取消收藏。
5. 刷新控制台确认收藏保留；可用临时收藏测试目录删除，注意确认框包含子目录和其中收藏。

浏览器工具一次连接尝试返回 browsers=[] / nodeRepl.fetch request failed，未能连接用户原浏览器，故尚未重载。自动 E2E 使用独立 profile 与本机预授权 fixture，不能替代真实 action Popup/activeTab/原生权限验收，也没有访问用户 Provider 凭据。

数据库升级到 IndexedDB v6；迁移测试确认旧历史、解析与译文保留。同一扩展升级后不可用较低数据库版本旧产物覆盖，沿用项目既有升级纪律。用户明确通过前不推送 release、不创建发布 PR、不切回 master、不删除 feature 工作区。
