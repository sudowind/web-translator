# 首轮 release 集成验收记录

日期：2026-09-04

工作区调整补记：以下路径保留为首轮集成时的历史记录。随后按用户要求，将主工作区 `D:\Projects\web-translate` 固定为 release，原独立 release 工作区改为 `D:\Projects\web-translate-worktrees\dev`。现在直接重载原主目录安装的插件，无需重新安装或配置；当前操作以 `docs/release-validation-workflow.md` 为准。

调整后验证：release 主目录与 dev 独立目录分别执行各自锁文件的 `npm ci --no-audit --no-fund`、`npm run build`、`npm run verify:output`，均通过。release 安装 21 秒、构建 5.720 秒；dev 安装 19 秒、构建 4.063 秒。两边依赖与产物独立，无功能代码变化，未重复全量 check/E2E；下述长文档门禁问题仍保留。未操作浏览器安装、卸载或存储，重载原扩展由用户完成。

状态：所有分支已集成、生产插件已构建；可开展人工验收，但完整 E2E 尚未全绿（长文档滚动窗口存在非稳定失败）。

## 集成范围

工作区：`D:\Projects\web-translate-worktrees\release`，分支：`release`。

| 来源分支 | 纳入的分支头 | 内容 |
| --- | --- | --- |
| dev | c656524 | arXiv 快速缓存恢复、通用翻译输出能力及 Qwen 前置加固 |
| codex/extension-dashboard | a0876c4 | 扩展控制台与阅读历史 |
| codex/pdf-night-mode | 034f0b4 | 夜间主题及原稿柔和暗化 |
| codex/dependency-security-upgrades | 187ecd8 | PDF.js、WXT、Vite 等依赖升级及类型适配 |

经用户确认，dev 原先 31 项变更及夜间模式 14 项变更先分别提交到原分支；所有来源保留原工作区。release 从 dev 创建，按 dev、依赖安全、Dashboard、夜间模式顺序使用非快进合并。未推送远端，未修改 master，未将 release 回灌功能分支。

## 冲突解决

- 保留 dev 的 Windows forks 隔离与最多 4 worker、分片 SSE 测试断言。
- 设置页同时保留 Dashboard 分区与翻译输出模式、测试期间禁用编辑；后台同时保留 hash 路由发送者校验和能力探测。
- 数据库使用 v5，兼容 dev v3 源映射与独立 Dashboard v4 历史结构；已有数据保留，缺失结构补齐。新增从空库、v2、v3、v4 升级的回归测试。
- PDF 服务同时保留 arXiv 标识恢复、历史记录与夜间模式；规格索引两侧均保留。
- WXT 新版测试类型调整权限 mock，运行时语义不变。
- 依赖分支新增截图前滚回顶部，与 dev 旧响应式截图不匹配。800px 使用依赖分支配套基线；375px 在配套基线上仍有 1 个滚动条边缘像素差异，检查实际图及差异图后由测试生成集成基线。未放宽截图阈值，其他快照未更新。

## 自动化与复核证据

- 定向测试：5 文件、61 项通过，含数据库迁移、仓储、设置交互、Provider 测试与 PDF 服务。
- 新 WXT 权限 mock 修正后：类型检查通过，设置交互单测 1 项通过。
- 独立只读集成复核完成，无待修 Critical / Important；截图修正由同一 reviewer 聚焦复核关闭。
- `npm run check` 在 c5ee663 通过：TypeScript、71 文件 / 484 项测试、WXT 生产构建、产物检查。Vitest 21.70 秒（transform 3.70 秒、setup 2.92 秒、import 累计 24.08 秒、tests 5.75 秒、environment 累计 24.96 秒），WXT 构建 4.883 秒。Windows 使用 forks、maxWorkers=4；累计阶段不是墙钟总时长。
- 产物检查：Unicode noncharacter=0、静态 host 权限=0、静态 content script=0、options 独立标签页=1。
- 首轮完整 E2E：11 通过、1 默认跳过、1 响应式截图失败，54.5 秒。按上述原因修正；定向场景生成基线后 1 通过、17.6 秒，不将更新快照运行当作最终验证。
- 9fad51d 相对 c5ee663 仅两张截图基线变动，生产代码、类型与单元测试内容不变，因此不重复完整 check；最终完整 E2E 在 9fad51d 上使用普通模式运行，不带快照更新标志。
- 最终普通模式完整 E2E（9fad51d）：11 通过、1 失败、1 默认跳过，52.9 秒。公开 PDF 完整链路（包括响应式截图、深色主题和恢复）通过；失败项为 76 页长文档快速滚动窗口：第 30 页渲染断言通过后，实际新增请求页集合为 28/29/30/31，而预期为 29/30/31/32。
- 对上述长文档场景仅做一次定向复现，未修改代码或断言：`npm run test:e2e -- tests/e2e/pdf-workspace.spec.ts -g '76 页长文档按需翻译'`，1 通过、13.4 秒。首轮完整 E2E 该用例也曾通过，说明结果非稳定；不能用定向通过覆盖完整门禁失败，不宣称 E2E 全绿。
- 最终完整 E2E 的长文档指标：首次可读 1735.3 ms、正文挂载 5 个、初始 Provider 请求 4 页、最大 render-to-commit 94.4 ms。失败发生在后续快速滚动的页集合校验，不能据此断言整体性能回归或已确认根因。
- 验证后仅补此中文报告，无实现或测试改动。所有来源分支头均可由 release 到达。

## 已知非阻断问题

- Minor：`web-translate-plugin/src/pdf/PdfWorkspace.tsx:319` 在旧 arXiv 字节 hash 缓存恢复较慢时，历史记录 ID 可能从 identity hash 切到旧字节 hash，产生同篇论文的两条记录。记录到本轮账本，后续回功能分支修复。

## 待定位的自动化门禁问题

- 长文档快速滚动时翻译窗口偏移：证据见上方最终 E2E 结果与 `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts:822`。当前未区分真实调度竞态与测试的滚动/测量时序问题，也不能断言由哪次合并引入。建议后续先在负责该功能的 dev 工作区复现定位，再提交修复并合回 release；不得通过放宽页集合断言或反复跑到通过关闭此项。

## 人工验收与安装

加载目录：`D:\Projects\web-translate-worktrees\release\web-translate-plugin\.output\chrome-mv3`。

操作流程见 `docs/release-validation-workflow.md`。首次加载 release 目录，停用但不卸载 dev 版；后续构建完成后只需重新加载 release 并刷新被测页面。不要假定新扩展与 dev 自动共享密钥、授权、历史或缓存。

未读取或复制用户凭据，未修改用户浏览器现有插件，未调用真实付费 Provider。自动化用模拟服务及授权后技术路径，真实 action Popup、原生权限弹窗、activeTab 以及真实 Provider 效果仍由用户验收。真实 arXiv 网络样本默认跳过，不能宣称完成该在线样本验证。

数据库 v5 不支持旧分支在同一扩展数据环境下直接降级使用；保持两个扩展或浏览器配置隔离，不覆盖 dev 构建目录、不清理用户数据。
