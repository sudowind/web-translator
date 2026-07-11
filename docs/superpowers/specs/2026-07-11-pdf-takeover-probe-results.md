# PDF 原 URL 接管技术探针结果

## 结论

`待真实 Chrome 验收（一期 HTTP/HTTPS）`

真实 PDF.js 首页渲染、`rendererVerified`、URL 不变、字节读取、恢复以及刷新/历史/复制标签/新标签语义，已经在明确隔离授权的 Chromium 技术矩阵中通过。但当前 Playwright 无法操作 Chrome 原生 optional-host 权限提示，也无法取得 `chrome.action.openPopup()` 创建的真实 action Popup target，因此尚未自动验证生产构建通过真实 Popup 获得 `activeTab` 后的完整路径。

在更新后的真实 PDF.js 构建完成实机复核前，不得把一期结论写成 `GO`。本地 `file://` 仍属于后续迭代，不是一期产品范围。

## 验收环境

- 日期：2026-07-11
- 既有真实 Chrome：`149.0.7827.201 (正式版本) （64 位） (cohort: Stable)`
- 自动化 Chromium：`149.0.7827.55`
- Playwright：`1.61.1`
- PDF.js：`pdfjs-dist 6.1.200`
- 插件源基线提交：`40e7b0f`
- 本结果提交：Git `HEAD`，提交信息 `fix: require verified pdfjs takeover for phase one go`
- 构建目录：`web-translate-plugin/.output/chrome-mv3`

## 已实现的验收强化

1. runtime content script bundle 使用真实 `pdfjs-dist/legacy` 加载 PDF，并把第一页渲染到 canvas。
2. 只有 canvas 渲染完成且尺寸有效时才返回 `rendererVerified=true`。
3. `TakeoverProbeResult` 新增 `rendererVerified`；未验证渲染返回 `renderer_unverified`，不能 `passed=true`。
4. 生产 manifest 只有 `optional_host_permissions`，没有静态 `host_permissions`。
5. WXT runtime content script 省略 `matches`，避免构建时自动把匹配模式提升为静态 host 权限；bundle 仅由后台在授权后注入。

## 授权后技术矩阵

该矩阵把生产构建复制到临时目录，只在临时副本中把 optional host 模式加入 `host_permissions`，并通过 `--allow-file-access-from-files` 运行 file 诊断。它验证接管与浏览器语义，不代表生产权限 gate 已通过。

| 属性 | 类型 | URL 一致 | PDF.js 首页 | rendererVerified | 字节可读 | 恢复 | 结果 |
|---|---|---:|---:|---:|---:|---:|---:|
| 一期技术证据 | arXiv / 公开 HTTPS | 是 | 是 | 是 | 是 | 是 | 通过 |
| 一期技术证据 | redirect/query/fragment | 是 | 是 | 是 | 是 | 是 | 通过 |
| 一期技术证据 | Cookie | 是 | 是 | 是 | 是 | 是 | 通过 |
| 后续诊断 | file:// | 是 | 是 | 是 | 是 | 是 | 通过 |
| 一期技术证据 | 刷新、back/forward、duplicate、新标签重开 | 是 | 是 | 是 | 是 | 是 | 通过 |

命令：`npm run test:e2e:authorized`。最终结果：`5 passed (26.0s)`。

浏览器语义场景在同一 HTTP fixture 上依次验证：初次启用、刷新后重新启用、历史后退回 PDF 后重新启用、前进到中间页再后退、`chrome.tabs.duplicate` 复制标签后启用、同 URL 新标签打开后启用；每次都验证恢复和原 URL 逐字不变。

## 生产权限路径自动化结果

### optional-host 请求尝试

曾在 Popup 真实按钮点击中调用 `chrome.permissions.request`。Chromium 原生权限提示不属于 Playwright web-content target，Promise 在 30 秒内一直 pending，Popup 按钮保持“运行中…”。该实现已移除，生产 HTTP/HTTPS 路径不再主动弹出该请求。

### action Popup / activeTab 尝试

随后从扩展测试页的真实点击调用 `chrome.action.openPopup()`，保持 PDF 标签在前台，以验证 Chrome 打开 action Popup 时授予的 `activeTab`。`browserContext.waitForEvent('page')` 在 5 秒后超时，说明 Playwright 没有暴露实际 action Popup target，无法继续点击其中的“运行探针”按钮。

因此生产 activeTab 路径当前是“自动化工具不可见”，不是“已通过”。没有继续通过静态提升生产权限或弱化断言来改写结果。

## 既有真实 Chrome 证据的适用范围

旧构建在真实 Chrome arXiv 上返回：原 URL 与最终 URL 都是 `https://arxiv.org/pdf/2401.00001#page=2`，`injected`、`bytesReadable`、`restored`、`passed` 均为 `true`。但旧构建只挂载 `data-renderer="pdfjs-probe"` marker，没有真实 PDF.js canvas，也没有 `rendererVerified` 字段。

所以旧 arXiv 结果只能证明旧 marker 接管、字节和恢复路径，不能证明更新后的真实 PDF.js/activeTab 生产路径。更新构建必须在真实 Chrome 重新复核。

旧本地 fixture 仍显示 `运行探针失败：Failed to fetch`。本地没有被写成已支持；授权后 file 自动化仅作为未来能力诊断。

## 项目检查

- `npm run check`：通过
- TypeScript：通过
- Vitest：7 个测试文件、37 个测试全部通过
- WXT Chrome MV3 构建：通过
- 构建产物包含 `content-scripts/pdf-probe-renderer.js`
- 生产 manifest：无 `host_permissions`；`optional_host_permissions` 为 HTTP、HTTPS 和 file 模式
- fixture：以 `%PDF-` 开头，包含 `PDF takeover probe fixture`，流长度和 xref 偏移一致

## 转为一期 GO 的剩余验收

在真实 Chrome 149.0.7827.201 或更新稳定版中加载本次构建，至少完成：

1. 前台打开 arXiv PDF，通过真实扩展 action Popup 点击“运行探针”。
2. 确认结果包含 `rendererVerified=true`、`bytesReadable=true`、`restored=true`、`passed=true`。
3. 确认 `originalUrl`、`finalUrl` 与地址栏 URL 逐字一致。
4. 对一个 HTTP fixture 复核刷新、后退/前进、复制标签和新标签打开后的重新启用与恢复。

任一项未通过时不能给出一期 `GO`。

## 后续本地文件动作

本地 `file://` 继续延期。后续必须实现 `chrome.extension.isAllowedFileSchemeAccess()`、真实用户手势中的 `chrome.permissions.request({ origins: ['file:///*'] })`、文件访问引导、结构化失败结果，以及 MinerU 上传前的文件名/大小/目标服务/第三方传输隐私确认。
