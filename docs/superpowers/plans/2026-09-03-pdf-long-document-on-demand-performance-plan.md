# PDF 长文档按需翻译与性能优化实施计划

日期：2026-09-03  
状态：已完成

## 目标

完整实现 `docs/superpowers/specs/2026-09-03-pdf-long-document-on-demand-performance-design.md`，让长 PDF 默认按需翻译，限制离屏译文和 PDF.js 资源成本，移除大文件 Base64 主传输路径，并通过确定性 76 页基准、完整测试和独立复核证明改进有效。

跨页段落识别与合并不在本计划范围内。

## 全局约束

- 所有规格、计划和实施报告使用中文。
- 同一共享工作树只运行一个实现任务；独立 reviewer 只读审查。
- 每个里程碑先写或调整定向测试，再实现，再运行受影响测试。
- 实现阶段不重复运行完整 `npm run check` 或 PDF E2E；全部 Critical/Important 问题关闭后统一运行一次。
- 真实浏览器源读取只做一次有证据的可行性门禁；若浏览器权限边界阻止，记录证据并修订方案，不反复探索。
- 保留认证上传同意、公共 URL 优先、hash 变化保护、错误脱敏和工作台恢复能力。

## 里程碑 1：长文档判定、按需调度与缓存快照

### 公开接口

- `TranslationMode = 'on-demand' | 'full-document'`
- `isLongPdfDocument(model)`
- 新的页级调度器：支持活动页窗口、阅读方向、显式导航、模式切换、缓存 hydration、失败和重试。
- `pdf:translation-snapshot` 消息及精确校验。
- `translationRepository.listByHash(hash)` 或等价批量接口。

### 文件

- 修改 `web-translate-plugin/src/translation/page-scheduler.ts`
- 新增或修改长文档判定纯逻辑模块
- 修改 `web-translate-plugin/src/pdf/messages.ts`
- 修改 `web-translate-plugin/src/storage/repositories.ts`
- 修改 `web-translate-plugin/src/pdf/workspace-service.ts`
- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改相关 unit tests

### 验收

- 76 页文档默认 `on-demand`，短文档默认 `full-document`。
- 初始页面只派发当前页、后两页和前一页的合法集合。
- 滚动活动页变化经过 350ms 稳定期；显式导航立即排队。
- 模式切换不取消 in-flight 请求，不重复请求 cached/done 页面。
- 一次快照恢复全部有效缓存页，损坏单页被忽略。
- 受影响纯逻辑、消息、存储和服务测试通过。

## 里程碑 2：译文虚拟化与 React 渲染隔离

### 公开接口

- 独立译文渲染窗口函数，默认半径 2。
- 页面级稳定 `PageTranslationState`。
- 页面壳与完整译文正文分离。
- 页内 `scrollTop` 内存恢复。

### 文件

- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改 `web-translate-plugin/src/agent/AgentPanel.tsx` 或增加隔离容器
- 修改 `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改相关 component/unit tests

### 验收

- 76 页页面壳存在，完整译文正文最多挂载 5 页。
- 未请求页不遍历区块，不显示“翻译中”。
- 离屏返回恢复译文和页内滚动位置。
- 单页完成、hover 和 Agent 50ms 增量不重渲染无关页面。
- 页面固定高度、页码跳转和主滚动位置保持稳定。

## 里程碑 3：PDF.js 页面尺寸与资源生命周期

### 公开接口

- scale=1 页面基础尺寸缓存。
- 初始页面尺寸窗口和空闲批处理，每批最多 4 页。
- 页面 Canvas/TextLayer 安全清理。

### 文件

- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/PdfViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/PdfTextLayer.tsx`
- 修改相关 PDF unit/component tests

### 验收

- 初始关键路径 `getPage()` 不超过活动页前后各 2 页。
- 缩放不重新读取全部页面代理。
- 空闲阶段分批补齐尺寸，不创建离屏 Canvas。
- 页面离开窗口时取消渲染并释放可释放资源。

## 里程碑 4：后台模型 LRU 与 MinerU ZIP 过滤

### 公开接口

- 最多 3 份 `DocumentModel` 的 Service Worker 生命周期 LRU。
- MinerU ZIP 只解压 `_content_list.json`。

### 文件

- 修改 `web-translate-plugin/src/pdf/workspace-service.ts`
- 修改 `web-translate-plugin/src/providers/mineru/result-loader.ts`
- 修改相关 service/provider tests

### 验收

- 翻译和 Agent 请求命中内存模型时不重复读取 IndexedDB。
- 第 4 份模型淘汰最久未使用项，清缓存同步失效。
- ZIP 中图片和无关文件不被解压，规范化结果不变。

## 里程碑 5：源字节路径与浏览器门禁

### 可行性门禁

在真实 Chromium 扩展环境中一次性验证公共 PDF、授权 HTTP(S) 源和 Cookie 认证 PDF 的内容脚本同源读取。保留命令、结果和边界证据。

### 目标接口

- 内容脚本本地加载 `{ descriptor, bytes }`，生产消息不携带完整 PDF。
- PDF.js 接管唯一字节所有权，React 不长期保存第二份字节。
- 后台只在认证上传同意或公共 URL 上传回退时重取并校验 hash。

### 文件

- 修改 `web-translate-plugin/src/pdf/pdf-source.ts`
- 修改 `web-translate-plugin/src/pdf/messages.ts`
- 修改 `web-translate-plugin/src/pdf/PdfWorkspace.tsx`
- 修改 `web-translate-plugin/src/pdf/PairedPageViewer.tsx`
- 修改 `web-translate-plugin/src/pdf/workspace-service.ts`
- 修改相关 source/message/service tests 和授权 E2E

### 验收

- 生产消息中不存在 PDF Base64、`number[]` 或 ArrayBuffer 载荷。
- 37 MiB 级输入不执行 Base64 编解码。
- 认证同意和 `PDF_SOURCE_CHANGED` 保护继续通过。
- 工作台关闭后原 URL 和原始 PDF 可恢复。

## 里程碑 6：76 页确定性基准与界面验收

### 文件

- 增加运行时生成的 76 页 PDF/DocumentModel 测试工具
- 修改 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 增加必要的渲染计数或结构性性能断言

### 验收

- 按需模式无滚动时请求页数不超过初始窗口。
- 完整译文正文同时挂载不超过 5 页。
- Agent 增量不触发阅读流 render。
- 快速滚动不逐页发送请求，稳定停留后目标页优先。
- 二次打开只做一次快照读取，缓存页不调用 Provider。
- 记录首次可阅读时间、Long Task、React commit 和内存基准，不把外网样本作为日常门禁。

## 里程碑 7：独立复核、修复波次与最终门禁

- 独立 reviewer 只读审查设计一致性、竞态、权限、安全、缓存完整性和性能断言。
- 合并所有 Critical/Important 为一个 fix wave，补回归测试并定向验证。
- 同一 reviewer 聚焦复核关闭原问题。
- 运行一次 `npm run check`。
- 运行一次 `npm run test:e2e -- pdf-workspace.spec.ts`。
- 记录阶段耗时、浏览器门禁结果、已知限制和 Minor 项。
- 回填本计划状态及实施报告；所有证据新鲜后才能声明完成。
