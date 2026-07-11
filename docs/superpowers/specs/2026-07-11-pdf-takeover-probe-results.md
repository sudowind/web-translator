# PDF 原 URL 接管技术探针结果

## 结论

`GO（一期 HTTP/HTTPS PDF 范围）`

更新后的真实 PDF.js 构建已经在 Chrome 149.0.7827.201 中通过真实扩展 action Popup 获得 `activeTab`，并在 arXiv 样本上返回 `rendererVerified=true`、`bytesReadable=true`、`restored=true`、`passed=true`。`originalUrl`、`finalUrl` 与地址栏 URL 逐字一致。

结合授权后 Chromium 技术矩阵已通过的重定向、Cookie、刷新、历史、复制标签和新标签语义，一期 HTTP/HTTPS PDF 接管探针达到 `GO` 门槛。本地 `file://` 仍属于后续迭代，不是一期产品范围，也不得据此宣称本地 PDF 已支持。

## 验收环境

- 日期：2026-07-11
- 既有真实 Chrome：`149.0.7827.201 (正式版本) （64 位） (cohort: Stable)`
- 自动化 Chromium：`149.0.7827.55`
- Playwright：`1.61.1`
- PDF.js：`pdfjs-dist 6.1.200`
- 插件源基线提交：`40e7b0f`
- PDF.js 验收强化提交：`4cfcd92`，提交信息 `fix: require verified pdfjs takeover for phase one go`
- 本结果更新：Git `HEAD`
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

命令：`npm run test:e2e:authorized`。记录真实 Chrome 结果后复跑：`5 passed (24.5s)`。

浏览器语义场景在同一 HTTP fixture 上依次验证：初次启用、刷新后重新启用、历史后退回 PDF 后重新启用、前进到中间页再后退、`chrome.tabs.duplicate` 复制标签后启用、同 URL 新标签打开后启用；每次都验证恢复和原 URL 逐字不变。

## 生产权限路径自动化结果

### optional-host 请求尝试

曾在 Popup 真实按钮点击中调用 `chrome.permissions.request`。Chromium 原生权限提示不属于 Playwright web-content target，Promise 在 30 秒内一直 pending，Popup 按钮保持“运行中…”。该实现已移除，生产 HTTP/HTTPS 路径不再主动弹出该请求。

### action Popup / activeTab 尝试

随后从扩展测试页的真实点击调用 `chrome.action.openPopup()`，保持 PDF 标签在前台，以验证 Chrome 打开 action Popup 时授予的 `activeTab`。`browserContext.waitForEvent('page')` 在 5 秒后超时，说明 Playwright 没有暴露实际 action Popup target，无法继续点击其中的“运行探针”按钮。

因此 Playwright 仍不能自动操作生产 action Popup。没有通过静态提升生产权限或弱化断言来冒充该路径；生产 `activeTab` 的最终证据来自下节记录的真实 Chrome 操作。

## 真实 Chrome 验收

### 更新构建：真实 PDF.js / activeTab

- Chrome：`149.0.7827.201 (正式版本) （64 位） (cohort: Stable)`
- measuredAt：`2026-07-11T09:28:53.232Z`
- tabId：`253795698`
- originalUrl：`https://arxiv.org/pdf/2401.00001#page=2`
- finalUrl：`https://arxiv.org/pdf/2401.00001#page=2`
- kind：`arxiv`
- injected：`true`
- rendererVerified：`true`
- bytesReadable：`true`
- restored：`true`
- passed：`true`

该结果来自用户在前台 arXiv PDF 标签页中打开真实扩展 action Popup 并点击“运行探针”，因此补齐了 Playwright 无法覆盖的生产 `activeTab` 授权链路。PDF.js 渲染、读取、恢复和 URL 不变均在同一次实机结果中得到验证。

### 旧构建证据边界

旧构建在真实 Chrome arXiv 上返回：原 URL 与最终 URL 都是 `https://arxiv.org/pdf/2401.00001#page=2`，`injected`、`bytesReadable`、`restored`、`passed` 均为 `true`。但旧构建只挂载 `data-renderer="pdfjs-probe"` marker，没有真实 PDF.js canvas，也没有 `rendererVerified` 字段。

旧 arXiv 结果只能证明旧 marker 接管、字节和恢复路径；本次 GO 结论不使用旧 marker 充当真实 PDF.js 证据。

旧本地 fixture 仍显示 `运行探针失败：Failed to fetch`。本地没有被写成已支持；授权后 file 自动化仅作为未来能力诊断。

## 项目检查

- `npm run check`：通过
- TypeScript：通过
- Vitest：7 个测试文件、37 个测试全部通过
- WXT Chrome MV3 构建：通过
- 构建产物包含 `content-scripts/pdf-probe-renderer.js`
- 生产 manifest：无 `host_permissions`；`optional_host_permissions` 为 HTTP、HTTPS 和 file 模式
- fixture：以 `%PDF-` 开头，包含 `PDF takeover probe fixture`，流长度和 xref 偏移一致

## GO 决策依据

1. 真实 Chrome 的生产 action Popup / `activeTab` 路径已在更新构建上通过。
2. 同一次实机结果验证了真实 PDF.js、字节读取、恢复和原 URL 逐字不变。
3. 授权后技术矩阵验证了重定向、Cookie、刷新、后退/前进、复制标签和新标签重新启用等与授权 UI 无关的浏览器语义。
4. 生产 manifest 没有静态 `host_permissions`，自动化授权边界已明确披露。
5. 本地 `file://` 由用户明确移至后续迭代，不计入一期门槛。

## 后续本地文件动作

本地 `file://` 继续延期。后续必须实现 `chrome.extension.isAllowedFileSchemeAccess()`、真实用户手势中的 `chrome.permissions.request({ origins: ['file:///*'] })`、文件访问引导、结构化失败结果，以及 MinerU 上传前的文件名/大小/目标服务/第三方传输隐私确认。

## PDF 产品工作台最终自动化验收（2026-07-11）

### 结论

`GO（HTTP/HTTPS PDF 产品工作台；file:// 仍不在范围内）`

在基线提交 `3f4167a` 上新增 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`。验收只使用本地 HTTP fixture 和本地 MinerU/OpenAI mock，不访问真实 Provider，也不读取真实 API Key 或 Token。

E2E 把生产构建复制到临时目录，仅在临时副本中把 HTTP/HTTPS `optional_host_permissions` 提升为测试 `host_permissions`。该路径只证明用户已经授权后的技术链路，不代表生产 action Popup、`activeTab` 用户手势或原生权限弹窗已经被 Playwright 自动验收；测试没有提升或执行 `file://` 权限。

### 浏览器场景

1. 公开通用 URL：`/download?id=public#page=2`
   - 地址逐字不变，工作台根节点为 `data-renderer="pdfjs"`，左栏双页可读。
   - MinerU 只创建一次 URL 单任务，并从 ZIP 中唯一的嵌套 `_content_list.json` 解析结果。
   - 第 2 页首先完成 OpenAI 翻译；论文问答返回 `[p:2]`，点击“第 2 页”同时定位左右栏。
   - 智能体可收起/展开；关闭工作台后恢复原生页面，刷新后不会自动重新接管，URL 仍不变。
2. 认证通用 URL：`/download?id=auth#page=2`
   - 无 Cookie 请求返回 200 HTML，带 Cookie 且 `credentials: include` 的请求返回 PDF。
   - 页面显示 MinerU、文件名、大小与第三方传输说明；点击同意前批量初始化和上传计数均为 0。
   - PDF 页数未准备好时同意按钮禁用；点击同意后只创建一次批量任务并上传一次，随后完成解析和第 2 页翻译。

MinerU 失败后左栏仍可读、安全错误态可重试的场景使用现有 reducer/service 定向单测作为证据，没有冒充第三个浏览器场景。新鲜命令 `npm test -- tests/unit/pdf/workspace-reducer.test.ts tests/unit/pdf/workspace-service.test.ts` 为 `2 files / 16 tests passed`，Vitest duration `931ms`。

### 验收中发现并修复的问题

- Chrome 拒绝注入生产 `pdf-workspace.js`，原始错误为 `It isn't UTF-8 encoded`。产物字符索引约 `2,629,966` 存在 KaTeX 词法正则产生的原样 `U+FFFF`。WXT/Vite 改用项目已有 esbuild minifier 并设置 ASCII 输出后，产物约 `2,704,485` bytes，Unicode noncharacter 扫描从 1 降为 0，后台真实 mount 通过。
- 认证同意 UI 早于 PDF.js 页数回调出现，立即点击会发送 `pageCount=0` 并在消息校验层失败。产品现在在 `documentPageCount < 1` 时禁用同意按钮。

### 新鲜验证

- `npm run build`：通过；WXT Chrome MV3 构建总计约 `6.68 MB`，`pdf-workspace.js` 约 `2.70 MB`。
- `npm run test:e2e -- pdf-workspace.spec.ts`：`2 passed (10.6s)`；公开场景 `2.5s`，认证场景 `2.2s`。
- 未运行全量 `npm run check`；该门禁由最终控制器在本次 feature/build 修复纳入后统一决定是否重跑。
