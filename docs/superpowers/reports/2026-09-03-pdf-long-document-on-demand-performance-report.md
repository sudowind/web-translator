# PDF 长文档按需翻译与性能优化实施报告

日期：2026-09-03
状态：已完成

## 1. 实施结论

`2026-09-03-pdf-long-document-on-demand-performance-design.md` 的产品实现、确定性长文档基准、单元测试、构建验证和本地浏览器 E2E 已完成。跨页段落识别与合并按规格明确排除，未在本次实现中改变。

长文档现在默认采用按需翻译：当前页与小范围相邻页优先，请求窗口在连续滚动停止 350 毫秒后更新，显式页码导航立即提权。用户仍可切换为全文翻译，已经完成或缓存的页面不会重复请求。

## 2. 已完成能力

- 使用页数和可翻译字符数统一判定长文档，阈值分别为 30 页和 100,000 字符。
- 引入支持按需/全文模式、阅读方向、显式导航优先级、缓存 hydration、失败与重试的页级调度器。
- 新增 `pdf:translation-snapshot`，一次恢复同一文档的有效页级缓存；损坏缓存页被隔离忽略。
- 译文仅为活动页前后各 2 页挂载完整正文，其余页面保留固定高度轻量壳。
- 页面内滚动位置保存在内存中，重新进入渲染窗口时恢复；已挂载正文不会因缓存偏移更新而无效重渲染。
- 页面翻译状态、区块 hover/pin 和 Agent 流式增量被隔离到必要组件；Agent 仍以 50 毫秒批量刷新。
- PDF.js 初始只读取活动页窗口的页面对象，基础尺寸按空闲批次（每批最多 4 页）补齐；缩放复用页面代理。
- Canvas 与 TextLayer 在渲染结算后按 generation 安全清理，避免旧渲染清理新页面资源。
- 后台使用最多 3 份 `DocumentModel` 的会话级 LRU，并对并发清缓存/旧 IndexedDB 读取增加 generation 屏障。
- MinerU ZIP 只解压内容清单，不再展开图片和无关文件。
- 内容脚本直接持有 PDF 字节并交给 PDF.js；生产消息不再传输完整 PDF Base64、`number[]` 或 ArrayBuffer。后台只在公共 URL 上传回退或认证上传已获同意时重取，并校验 hash。
- 公共 URL 回退保留 `PDF_SOURCE_CHANGED`，本地直接读取失败后仍会尝试带凭据读取。
- 更新工具栏模式选择、未请求页文案、当前页/缓存/预取反馈及必要的响应式截图基线。

## 3. 独立复核与修复

独立 reviewer 首轮提出 6 个 Important 问题，均在同一修复波次处理并由同一 reviewer 复核关闭：

1. 显式导航优先级可能被旧滚动窗口覆盖。
2. hover 可能引发整页译文无效渲染。
3. TextLayer 尚未结算时可能提前 cleanup。
4. 公共 URL 回退吞掉 `PDF_SOURCE_CHANGED`。
5. 并发清缓存后旧 IndexedDB 读取可能重新注入 LRU。
6. 未知页面高度随活动页比例变化，导致全文布局漂移。

浏览器回归随后进一步定位到页内 `initialScrollTop` 仅用于离屏恢复，却在正文已挂载时成为无效渲染依赖。最终通过语义化 `React.memo` 比较消除该重渲染，同时保留正文重新挂载时的滚动恢复。

最终聚焦复核无 Critical、无 Important。保留一项 Minor：现有测试覆盖 comparator 分支和渲染窗口切换，但尚未用真实 DOM 完整执行“正文滚动 → deferred → 重新挂载 → 校验 `scrollTop`”生命周期；不影响本轮实现结论，后续可作为回归增强补充。

## 4. 最终验证

### 4.1 发布门禁

命令：`npm run check`

- TypeScript：通过。
- Vitest：58 个测试文件、346 条测试全部通过。
- WXT Chrome MV3 构建：通过，构建耗时约 3.35 秒。
- 生产产物验证：Unicode noncharacter 为 0、静态 host 权限为 0、静态 content script 为 0。

### 4.2 本地 PDF 浏览器 E2E

命令：`npm run test:e2e -- tests/e2e/pdf-workspace.spec.ts`，运行前明确移除 `PDF_ARXIV_FEASIBILITY`。

- 公开 PDF 全链路：通过。
- 76 页确定性长文档：通过。
- 失败诊断与自动重试：通过。
- 认证 PDF 上传同意：通过。
- 真实 arXiv 可行性用例：按设计跳过，不属于日常发布门禁。

结果：4 通过，1 跳过，总耗时约 27.8 秒。

### 4.3 76 页确定性基准

当前最终构建记录：

| 指标 | 结果 |
| --- | ---: |
| 首次可阅读时间 | 约 1,701.6 ms |
| 初始 Provider 请求页数 | 4 页 |
| 同时挂载完整译文正文 | 5 页 |
| 大于 50 ms 的 Long Task | 3 个 |
| 最长 Long Task | 286 ms |
| 滚动最大帧间隔 | 约 7.1 ms |
| 阅读流 render 次数 | 66 次 |
| 最大 render-to-commit | 约 106.2 ms |
| JS heap 增量 | 14,519,379 字节，约 13.85 MiB |

这些指标来自运行时生成的 76 页 PDF 与 `DocumentModel`，适合持续回归；它们不等同于真实 37.4 MB arXiv 文件的网络、解码和图片压力。仓库另有约 36 MiB 字节输入测试，验证主消息路径不会执行 Base64 编解码。

## 5. 真实 arXiv 门禁记录

首次真实站点尝试的目标为 `https://arxiv.org/pdf/2510.12403`。Chromium trace 记录到文档响应为 HTTP 200、`application/pdf`、`content-length: 37,418,212`，内容脚本也已启动同 URL 读取；但当时测试仍使用 5 秒标题断言，第二次 37.4 MB 读取尚未完成时用例就终止，trace 中该请求因此显示状态 `-1`。

该证据说明读取流程已启动，但不足以证明真实大文件在允许时间内完成，也没有证明是浏览器权限边界失败。测试随后把该可选门禁的用例超时调整为 180 秒、标题等待调整为 90 秒。

获得用户明确复验授权后，仅运行以下单一用例：

`$env:PDF_ARXIV_FEASIBILITY='1'; npm run test:e2e -- tests/e2e/pdf-workspace.spec.ts --grep "真实 arXiv"`

结果为 1 通过，用例耗时约 39.2 秒、进程总耗时约 42.5 秒。验收确认：

- 工作台保持 `https://arxiv.org/pdf/2510.12403` 原 URL；
- 标题包含 `2510.12403`；
- PDF.js 验证页数为 76；
- 第 1 页 Canvas 可见；
- 关闭工作台后重新加载原始 PDF URL，工作台节点消失。

因此真实 arXiv 浏览器可行性门禁已通过，且未新增静态 host 权限。

## 6. 逐项完成度审计

| 规格要求 | 权威证据 | 结论 |
| --- | --- | --- |
| 长文档判定、按需窗口、350 毫秒稳定期、显式导航优先级、模式切换 | `document-policy.test.ts`、`page-scheduler.test.ts`、76 页 E2E | 已证明 |
| 译文正文最多挂载 5 页、未请求页轻量化、页级引用稳定、hover 与 Agent 隔离 | `workspace-components.test.tsx`、`paired-page-loading.test.tsx`、公开 PDF 与 76 页 E2E、独立复核 | 已证明 |
| PDF.js 初始窗口读取、缩放复用、Canvas/TextLayer 安全释放、稳定页面估算 | `paired-page-loading.test.tsx`、`pdf-page-canvas.test.tsx`、`pdf-layers.test.tsx`、76 页 E2E | 已证明 |
| 生产消息无整文件 Base64，36 MiB 输入不创建消息副本，公共/认证回退与 hash 保护 | `messages.test.ts`、`pdf-source.test.ts`、`workspace-service.test.ts`、公开与认证 PDF E2E | 已证明 |
| 一次缓存快照、缓存页不调用 Provider、最多 3 份模型 LRU、并发清缓存隔离 | `workspace-service.test.ts`、76 页二次打开 E2E | 已证明 |
| MinerU ZIP 只接受 `_content_list.json`，图片与其他文件不解压 | `providers/mineru/result-loader.test.ts` | 已证明 |
| 当前真实 arXiv 37.4 MB 样本完成读取并恢复原 URL | 获授权后单独复验，标题、76 页、第 1 页 Canvas 和原 URL 恢复全部通过 | 已证明 |
| 当前源码完整发布门禁和本地 PDF E2E | `npm run check` 58/346；PDF E2E 4 通过、1 按设计跳过 | 已证明 |

目标中的每项实现和验证均有直接证据，完整发布门禁、本地 PDF E2E、独立复核和真实 arXiv 可行性门禁均已完成。

## 7. 已知限制

- MinerU 仍是整篇解析完成后返回，按需策略只覆盖翻译请求、渲染与缓存恢复，不是增量解析。
- 跨页段落识别、合并和上下文补全不在本次范围。
- 翻译模式不持久化；重新打开时按文档规模重新选择默认模式，但复用页级缓存。
- 真实外网样本受网络波动影响，只作为可选人工门禁，不纳入日常发布门禁。

## 8. 历史设计覆盖说明

本实现以内容脚本本地持有源字节并直接交给 PDF.js 为准，取代历史报告中“后台通过 Base64 向工作台返回完整 PDF”的描述。历史文档保留为当时实现记录，不再代表当前生产主路径。
