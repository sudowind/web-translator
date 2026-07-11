# 探针任务 5 实施报告

## 状态

`DONE`

## 提交

- 插件源基线：`9b3db721366614a8dc8f3c5017da94beb0a2d321`
- 本任务提交：Git `HEAD`，提交信息 `docs: record pdf takeover phase-one go result`
- 最终结论：`GO（一期 HTTP/HTTPS PDF 范围）`

## 文件清单

- 新增 `web-translate-plugin/fixtures/probe.pdf`
- 新增 `web-translate-plugin/tests/e2e/pdf-takeover.spec.ts`
- 修改 `web-translate-plugin/playwright.config.ts`
- 修改 `web-translate-plugin/vitest.config.ts`
- 修改 `web-translate-plugin/package.json`，增加一期 E2E gate 脚本
- 新增 `docs/superpowers/specs/2026-07-11-pdf-takeover-probe-results.md`
- 修改 `docs/superpowers/specs/2026-07-11-web-translation-chrome-extension-design.md`
- 修改 `docs/superpowers/plans/2026-07-11-pdf-workspace-plan.md`
- 修改 `docs/superpowers/plans/2026-07-11-pdf-takeover-probe-plan.md`

## 自动化证据

- Playwright：1.61.1
- 临时 Chromium：149.0.7827.55
- 完整诊断 E2E：arXiv、file、302/query/fragment、Cookie 四类 `4 passed (17.2s)`
- 一期 gate：arXiv/公开 HTTPS、302/query/fragment、Cookie `3 passed (19.0s)`；file 用例带 `@future-file-diagnostic` 标签并由一期脚本排除
- 每个执行样本均断言 URL 原值与终值一致、注入、PDF 字节可读、恢复、`passed` 和探针后页面 URL
- 初次生产构建程序化轮次缺少 `activeTab` 临时授权，是 harness 伪阴性，不用于结论

## 真实 Chrome 证据

- 版本：`149.0.7827.201 (正式版本) （64 位） (cohort: Stable)`
- arXiv：tabId `253795698`；原 URL 与最终 URL 均为 `https://arxiv.org/pdf/2401.00001#page=2`；kind `arxiv`；`injected`、`bytesReadable`、`restored`、`passed` 均为 `true`；measuredAt `2026-07-11T08:22:28.797Z`
- 本地 fixture：Popup 原始错误 `运行探针失败：Failed to fetch`，没有结构化成功结果；没有写成本地已支持

## 范围决策与根因评估

用户在真实 Chrome 诊断后决定一期仅支持 HTTP/HTTPS PDF，本地 `file://` 延后。自动化在明确 host 权限和 file access 下通过，说明本地不是当前接管架构的阻塞；生产配置缺少运行时 optional `file:///*` host permission 授予流程、文件 scheme access 检查和用户引导。

后续本地迭代必须实现 `chrome.extension.isAllowedFileSchemeAccess()`、`chrome.permissions.request({ origins: ['file:///*'] })`、文件访问引导、结构化读取错误，以及 MinerU 上传隐私确认。

## 最终结论

`GO（一期 HTTP/HTTPS PDF 范围）`

一期 HTTP/HTTPS 自动化 gate 通过，真实 Chrome arXiv 通过。本地真实 Chrome 失败完整保留，但已由用户明确移出一期 Phase 0/MVP gate。

## 自查

- 主设计、PDF workspace 计划和原 probe 计划已同步一期范围，避免规格与计划继续把本地列为硬门槛。
- file E2E 保留为未来能力诊断，不作为一期 gate。
- fixture 以 `%PDF-` 开头并包含 `PDF takeover probe fixture`，流长度与 xref 偏移已复验。
- 未实现正式 PDF.js、MinerU 或翻译功能。
