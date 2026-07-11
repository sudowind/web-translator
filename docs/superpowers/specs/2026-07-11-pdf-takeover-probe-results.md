# PDF 原 URL 接管技术探针结果

## 结论

`GO（一期 HTTP/HTTPS PDF 范围）`

一期范围包括 arXiv、公开 HTTP/HTTPS、重定向/query/fragment 和依赖浏览器 Cookie 的 HTTP/HTTPS PDF。自动化授权 Chromium 的一期样本全部通过，真实 Chrome arXiv 样本也通过，因此一期 PDF 工作台可以继续开发。

本地 `file://` PDF 不属于一期范围。真实 Chrome 本地 fixture 显示 `运行探针失败：Failed to fetch`，没有结构化成功结果；本文完整保留该失败，绝不表示本地 PDF 已支持。

## 范围决策

原探针计划把本地 `file://` 作为硬门槛。真实 Chrome 诊断后，用户决定一期仅支持 HTTP/HTTPS PDF，把本地文件延后到后续迭代。本地失败不是当前接管架构的阻塞证据：自动化 Chromium 在临时 manifest 明确授予 `file:///*` host permission 并开启 file access 后，本地 fixture 的 URL、注入、字节读取和恢复断言全部通过。

当前生产配置只有 `optional_host_permissions`，尚未实现运行时可选 `file:///*` host permission 授予流程，也没有完整的文件访问开关检查与用户引导。因此本地真实 Chrome 失败不能改写成通过，但可以作为一项明确、可隔离的后续权限与产品流程任务，而不阻止一期 HTTP/HTTPS 架构。

## 验收环境

- 日期：2026-07-11
- 真实 Chrome：`149.0.7827.201 (正式版本) （64 位） (cohort: Stable)`
- 自动化 Chromium：`149.0.7827.55`
- Playwright：`1.61.1`
- 插件源基线提交：`9b3db721366614a8dc8f3c5017da94beb0a2d321`
- 本结果提交：Git `HEAD`，提交信息 `docs: record pdf takeover phase-one go result`
- 构建目录：`web-translate-plugin/.output/chrome-mv3`
- Chrome 最低版本：120
- 扩展格式：Manifest V3

## 自动化验收

E2E 使用持久化、有界面的 Chromium Context。测试把生产构建复制到临时目录，只在临时 manifest 中把 `optional_host_permissions` 合并到 `host_permissions`，用于补偿程序化 harness 没有真实 action 点击所导致的 `activeTab` 授权差异；生产 `wxt.config.ts` 未修改。

每个样本都断言：探针前后 URL 逐字一致、`injected=true`、`bytesReadable=true`、`restored=true`、`passed=true`，并在重定向完成后以探针启用前的实际 `page.url()` 作为原 URL。

| 验收属性 | 类型 | 样本 | URL 一致 | 注入 | 字节可读 | 恢复 | 结果 |
|---|---|---|---:|---:|---:|---:|---:|
| 一期 gate | arXiv / 公开 HTTPS | `https://arxiv.org/pdf/2401.00001#page=2` | 是 | 是 | 是 | 是 | 通过 |
| 一期 gate | redirect/query/fragment | 本地 HTTP 302；入口含 query 与 fragment | 是 | 是 | 是 | 是 | 通过 |
| 一期 gate | Cookie | 本地 HTTP `session=probe-ok` 门控 PDF | 是 | 是 | 是 | 是 | 通过 |
| 后续诊断 | file:// | `file:///D:/Projects/web-translate/web-translate-plugin/fixtures/probe.pdf` | 是 | 是 | 是 | 是 | 通过 |

最新完整诊断矩阵：`4 passed (17.2s)`。一期 gate 可通过 `npm run test:e2e:phase-one` 单独执行，使用 `--grep-invert @future-file-diagnostic` 排除本地诊断样本，最新结果为 `3 passed (19.0s)`；完整 `npm run test:e2e -- pdf-takeover.spec.ts` 仍运行四类样本。

### 初次未授权轮次

初次直接加载生产构建并从扩展页程序化发送消息，没有真实点击扩展 action，`activeTab` 临时授权未生效。arXiv 与本地 fixture 均返回 `script_injection_blocked`，原始错误明确要求 manifest host permission。临时测试构建授予对应 host 权限后四类全部通过，证明初次结果是 harness 权限伪阴性；该轮不参与一期结论。

## 真实 Chrome 验收

### arXiv

- tabId：`253795698`
- originalUrl：`https://arxiv.org/pdf/2401.00001#page=2`
- finalUrl：`https://arxiv.org/pdf/2401.00001#page=2`
- kind：`arxiv`
- injected：`true`
- bytesReadable：`true`
- restored：`true`
- passed：`true`
- measuredAt：`2026-07-11T08:22:28.797Z`

结论：真实 Chrome arXiv 样本通过，地址栏 URL 含 fragment 且逐字不变。

### 本地 file fixture

- 样本：`file:///D:/Projects/web-translate/web-translate-plugin/fixtures/probe.pdf`
- Popup 原始错误：`运行探针失败：Failed to fetch`
- 结构化结果：没有返回
- URL 一致：无法证明；错误响应没有 `originalUrl` 或 `finalUrl`
- 注入：无法证明；错误响应没有 `injected`
- 字节可读：否；PDF 读取抛出 `Failed to fetch`
- 恢复：无法证明；错误响应没有 `restored`
- 产品状态：后续迭代，不属于一期 gate

真实 Chrome 没有继续重复公开 HTTPS、重定向和 Cookie 类别；这些类别已有授权自动化证据。真实 Chrome 结果与自动化结果分别记录，没有把自动化冒充为实机结果。

## 根因评估

已知证据支持“生产权限授予流程缺失”，不支持“PDF 接管架构无法处理本地文件”：

1. 自动化在明确授予 `file:///*` host permission 并允许 file access 后，本地 fixture 全部断言通过。
2. 真实 Chrome 生产构建的 Popup 在字节读取阶段显示 `Failed to fetch`。
3. 生产 manifest 把 `file:///*` 放在 `optional_host_permissions`，但当前产品没有在真实用户手势中调用运行时权限请求，也没有先检查 Chrome 文件 scheme 访问开关。
4. 因此一期不宣称支持本地文件；后续通过权限检查、请求和用户引导闭合该差距。

## 项目检查

- `npm run check`：通过
- TypeScript：通过
- Vitest：6 个测试文件、32 个测试全部通过
- WXT Chrome MV3 构建：通过
- fixture 签名：以 `%PDF-` 开头
- fixture 内容：包含 ASCII 文本 `PDF takeover probe fixture`
- fixture 结构：流长度 `57` 与实际一致，`startxref=418` 与实际 xref 偏移一致

## 决策理由

1. 一期所有 HTTP/HTTPS 自动化 gate 样本通过。
2. 真实 Chrome arXiv 的 URL、注入、字节读取和恢复全部通过。
3. 本地失败可以由明确的权限与用户引导流程单独解决，不要求改变 URL 不变或 PDF.js 接管架构。
4. 用户明确把本地 `file://` 移到后续迭代，因此它不是一期 Phase 0 或 MVP 的完成门槛。
5. 一期仍不得通过 URL 跳转或原生 PDF 查看器降级来绕过 HTTP/HTTPS 硬约束。

## 后续本地文件动作

1. 调用 `chrome.extension.isAllowedFileSchemeAccess()`，识别 Chrome 的“允许访问文件网址”状态。
2. 在真实用户手势中调用 `chrome.permissions.request({ origins: ['file:///*'] })`，并为拒绝或未开启 file access 提供明确引导。
3. 让 PDF 字节读取异常返回结构化结果，保留 URL、注入、尽力恢复状态、失败码与原始错误。
4. 上传 MinerU 前展示文件名、大小、目标服务和第三方传输说明，只有用户确认后才上传。
5. 完成后重新运行本地诊断自动化，并在真实 Chrome 复核绝对 `file:///` fixture；通过前不得宣称支持本地 PDF。
