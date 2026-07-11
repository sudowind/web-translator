# 探针任务 5 实施报告

## 状态

`DONE`

## 结果状态

`待真实 Chrome 验收（一期 HTTP/HTTPS）`

## 提交

- 基线提交：`40e7b0f`
- 本任务提交：Git `HEAD`
- 提交信息：`fix: require verified pdfjs takeover for phase one go`

## 本轮修复

- 新增真实 `pdfjs-dist 6.1.200` runtime content script bundle，渲染 PDF 第一页 canvas。
- `TakeoverProbeResult` 新增 `rendererVerified`；未验证时返回 `renderer_unverified`。
- 生产 manifest 保持仅 optional host 权限，无静态 `host_permissions`。
- 新增 PDF.js helper 单测、runner 门槛测试和 WXT/E2E 契约测试。
- 授权后 E2E 覆盖 arXiv、file 诊断、302/query/fragment、Cookie，以及刷新、back/forward、duplicate、新标签和恢复。
- 移除未采用的 HTTP `request-host-permission` 实现与测试。

## 验证证据

- 最终 Vitest：7 个测试文件、37 个测试通过。
- 授权后技术矩阵：`5 passed (26.0s)`。
- `npm run check`：TypeScript、7 个测试文件/37 个测试、WXT build 通过。
- PDF.js bundle：`.output/chrome-mv3/content-scripts/pdf-probe-renderer.js`。
- 生产 manifest：没有 `host_permissions`，只保留 optional HTTP/HTTPS/file。

## 自动化限制

- Popup 按钮中的 `chrome.permissions.request` 原生提示 30 秒不返回，Playwright 无法接受该浏览器 UI；该方案已移除。
- 通过真实点击调用 `chrome.action.openPopup()` 后，Playwright 5 秒内没有得到 popup `page` target，无法点击实际 action Popup。
- 因此 activeTab 生产路径尚未自动验收；授权后临时矩阵不冒充生产权限 gate。

## 真实 Chrome 证据边界

旧 arXiv PASS 来自 marker 构建，没有真实 PDF.js 或 `rendererVerified`，不能作为本次构建 GO 证据。旧本地 `Failed to fetch` 继续保留，本地仍属于后续迭代。

## 自查

- `.npm-cache/` 不提交。
- 未实现产品 PDF 工作台、MinerU 或翻译功能。
- 文档没有把未自动化或旧 marker 结果写成更新构建已通过。
