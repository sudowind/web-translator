# PDF 翻译状态与阅读位置自动恢复实施报告

日期：2026-09-04
状态：dev 定向验证完成，待协调任务集成与完整门禁

## 行为与实现

之前解析和译文可以命中缓存，但刷新会丢失动态注入的工作台，且初始化未读取普通 URL 的历史位置。现在按文档记住启用状态和页码、页内比例、缩放；打开前先读取记忆，刷新及新标签页自动恢复。显式 `#page=` 优先，主动关闭会在 reload 前保存关闭状态，位置更新不会重新开启。

普通 URL 查询参数严格隔离、只去片段；arXiv PDF 使用带版本身份，不自动接管 abs HTML。chrome.storage.local 键为 SHA-256 摘要，记录不另存完整 URL。没有修改 IndexedDB 版本或缓存 schema。只在 dev 开发及构建，不覆盖 release 人工验收产物。

自动恢复仅检查曾启用的文档，预检当前文档 URL 与 PDF Content-Type，随后用 documentId 注入。站点注入权限由 Chrome 执行；自动流程不申请权限。Popup 的用户点击可申请当前站点的可选权限，拒绝仍允许本次 activeTab 使用，但不保证重新打开自动生效。未增加静态主机权限或静态内容脚本。

认证 PDF 原有上传同意保留。恢复后复用缓存并继续既有调度，可能对未完成页面产生翻译请求；不是全站自动翻译。HTTP(S) 普通浏览器环境为本轮范围，本地文件与隐身模式不持久恢复。滚动停顿 200 ms 保存、pagehide 尽力补存，浏览器立即销毁文档时末次消息可能无法完成。

## 验证记录

- 第一轮状态/恢复/接管/页码/Popup 定向测试：5 文件 / 23 项通过（2.15 秒）；类型检查通过。
- 阅读组件定向命令：`npm run test -- tests/unit/pdf/paired-page-loading.test.tsx tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/paired-page-viewer.test.tsx`，3 文件 / 13 项通过（3.39 秒）。
- 独立只读复核发现 1 项 Important：同 URL 刷新后的旧文档消息可能借新文档 status 写入位置。已要求主框架/documentId，并绑定状态查询；导航代际 guard 延伸至存储 read 之后、set 之前。同一复核者聚焦复核确认关闭，无剩余阻塞项。
- 修复后定向命令：`npm run test -- tests/unit/pdf/reading-state.test.ts tests/unit/pdf/reading-state-handler.test.ts tests/unit/pdf/auto-resume.test.ts tests/unit/pdf/takeover-port.test.ts tests/unit/pdf/source-page.test.ts tests/unit/pdf/popup-client.test.ts`，6 文件 / 31 项通过（2.62 秒）；`npm run typecheck` 通过；`npm run build` 通过（WXT 3.744 秒，产物 7.21 MB）。组件代码此时未再变化。
- 新增自动恢复 E2E：第 40 页、页内 25%、120% 缩放；刷新和新标签页均不再次调用 enable；缓存解析与翻译请求未增加；显式 page=2 优先；关闭后刷新不启动；其他 URL 不启动。修复后该用例通过，12.8 秒。
- arXiv 缓存 E2E 改为重新打开时不手动 enable，原稿子请求阻塞时仍恢复译文；用例通过，3.9 秒。测试路由仅阻塞非导航请求，避免自动恢复启动时序与测试设置竞争。
- 三项里程碑命令 `npm run test:e2e -- --grep '记住 PDF|arXiv 二次打开|76 页长文档'` 首轮为 2 通过 / 1 失败。长文档失败证据是预取方向：实际集合 28/29/30/31、预期 29/30/31/32；单 RAF 模拟 40→10→20→30 时观察器合并成 40→30，不能证明中间页已被观察。测试改为每次模拟滚动后按 RAF 等待实际当前页，再继续下一次，不放宽数量、方向或延迟断言。
- 修正后 `npm run test:e2e -- --grep '76 页长文档'` 通过（用例 8.4 秒，总计 11.7 秒）。单次性能观测：首次可读 1359.9 ms、52 次读取渲染、最大提交耗时 80.1 ms、堆增量 15,922,083 字节、最多 5 页译文正文、初始翻译 4 页、2 次长任务且最长 250 ms；不作真实设备性能保证。
- 新增用例第一次在刷新前设置位置阶段失败，原因是打断尚未结束的平滑跳页；等待目标页 top≈68 后再设置页内位置即通过。保留真实滚动和原位置断言，没有以存储注入代替阅读操作。
- 本任务不重复执行完整 check/E2E；由协调任务在 release 集成后执行最终门禁。上述测试使用独立临时 Chromium 和测试 Provider，未调用真实付费接口，也不代表真实 action Popup/activeTab/原生权限弹窗验收。

## 协调集成注意事项

开发工作区 `D:/Projects/web-translate-worktrees/dev`、分支 dev；协调任务 `01a06a3b-1038-7030-9ce9-2fa27d02b404` 负责普通 merge、冲突、release 完整门禁和固定目录构建。本任务不直接合入 release、不推送、不回灌。

release 已有历史记录与夜间模式增强。合并 PdfWorkspace/background/content runtime 时同时保留历史更新、主题偏好和本轮自动恢复，数据库继续保持 release 的 v5。新阅读状态独立于历史库，不需要将 release 历史分支整体合回 dev。既有历史记录不会批量隐式开启 PDF；老用户需要在此版本启用一次，才建立本轮记忆记录。

人工验收：重载原扩展后，对真实论文点击一次“翻译此 PDF”；如果 Chrome 询问，按意愿授予当前站点权限。阅读到中间页，停止滚动后刷新并重新打开，确认页码、页内位置和缩放；关闭工作台后刷新确认保持原生 PDF。不同签名 URL 视为不同普通文档；arXiv 版本彼此隔离。无需卸载或清空缓存。
