# arXiv PDF 标识缓存与快速恢复实施计划

日期：2026-09-03  
状态：已完成（2026-09-04）

## 目标

完整实现 `docs/superpowers/specs/2026-09-03-arxiv-pdf-identity-cache-fast-restore-design.md`，让 arXiv 二次打开先通过规范化论文标识和轻量版本校验恢复解析及译文缓存，避免完整 PDF 下载与 SHA-256 阻塞，同时保持通用 PDF、认证上传和缓存完整性边界。

## 全局约束

- 规格、计划和实施报告使用中文。
- 同一工作树只运行一个实现任务。
- 先补定向测试，再实现对应代码；实现期间不重复运行完整门禁。
- 数据库升级必须保留既有数据，清理操作必须覆盖新增源映射。
- 不新增静态主机权限，不扩大认证 PDF 的自动上传范围。
- 真实 arXiv 网络验证只在既有显式环境门禁下执行一次，不反复尝试浏览器能力边界。

## 里程碑 1：arXiv 身份与消息协议

- 新增 `web-translate-plugin/src/pdf/arxiv-source.ts`。
- 修改 `web-translate-plugin/src/pdf/messages.ts` 与相关单元测试。
- 验收现代、旧式、带版本及等价 URL 规范化；拒绝相似域名、非法路径和非法 ID。
- 新的缓存解析消息只接受原始 URL，后台重新规范化并保持精确字段校验。

## 里程碑 2：持久源映射与修订校验

- 修改 `web-translate-plugin/src/storage/db.ts`、`repositories.ts`、`workspace-service.ts` 及测试。
- IndexedDB v3 新增 `sources`、`by-hash` 和 documents 的 `by-source-url` 索引。
- 新格式直接按 arXiv 键命中；升级前缓存按源 URL 懒迁移。
- 显式版本不发 `HEAD`；无版本只读取响应头。
- 修订变化原子清除旧缓存，探测失败不破坏缓存。
- 新解析完成与缓存命中都会更新源映射。

## 里程碑 3：非阻塞工作台启动与 PDF.js URL 输入

- 修改 `pdf-source.ts`、`PdfWorkspace.tsx`、`PairedPageViewer.tsx`、`workspace-reducer.ts` 及测试。
- arXiv 不调用通用整文件源读取即可查询缓存。
- PDF.js 以 URL 启动；缓存模型提供页数时右栏先于 PDF 就绪渲染。
- 缓存探测结束前不误启 MinerU；未命中后只启动一次解析。
- 通用公共源允许标准 HTTP 缓存，认证源行为不变。
- 状态文案准确区分缓存检查、缓存恢复、PDF 加载和 MinerU 解析。

## 里程碑 4：回归、性能证据与提交

- 运行身份、消息、存储、服务、组件和源读取定向测试。
- 更新 PDF E2E，证明二次打开快速路径不触发正文读取或 Provider 请求，并保持译文恢复。
- 运行一次 `npm run check`。
- 运行一次 `npm run test:e2e -- pdf-workspace.spec.ts`。
- 生成中文实施报告，记录验证结果与网络修订头缺失时的边界。
- 更新规格与计划状态，提交并推送 `dev`。

## 完成记录

- 四个里程碑已完成；缓存清理的首次迁移与迟到索引读取竞态已修复并通过独立聚焦复核。
- `npm run check`：61 个测试文件、396 项测试通过，类型检查、生产构建和产物校验通过。
- `npm run test:e2e`：12 项通过、1 项默认关闭的真实在线 arXiv 门禁跳过，无失败。
- 全量验收期间修正网页 E2E 的 SSE 模拟接口，并将 Windows Vitest 改为 4-worker 独立进程池；不改变测试范围、断言或生产权限。
- 详细证据及边界记录：`docs/superpowers/reports/2026-09-04-arxiv-pdf-identity-cache-fast-restore-report.md`。
