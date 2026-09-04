# 项目协作约定

## 固定工作区与人工验收

- 主工作区 `D:\Projects\web-translate` 固定使用 `release` 分支，作为人工验收与浏览器插件加载入口；不得为开发临时切回 dev 或 feature 分支。
- `dev` 工作区为 `D:\Projects\web-translate-worktrees\dev`；各 feature 分支继续使用各自独立工作区。
- 功能修复在所属开发分支提交，再以普通 merge 合入 release；集成冲突在 release 解决，不将 release 整体回灌 feature 分支。
- 验收插件固定加载 `D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3`。每轮合并与构建后重载原扩展，不卸载、不清空配置，不将开发工作区产物覆盖到此目录。
- 数据库升级后不要用较低数据库版本的旧分支覆盖验收插件；独立回测使用独立浏览器环境。完整流程见 release 分支的 `docs/release-validation-workflow.md`。

## 文档语言

- 本项目中的所有设计规格（spec）和实施计划（plan）必须使用中文编写。
- 文件名可以保留英文或日期前缀，但正文、标题、验收标准和任务说明必须使用中文。
- 引用的 API 名称、代码标识符、协议名及官方资料标题可以保留英文。
- 修改既有 plan/spec 时，应同步把相关英文内容改为中文，避免中英文规格并存。

## 当前规格记录

- PDF 可见页清晰度补全：`docs/superpowers/specs/2026-09-04-pdf-visible-page-sharpness-design.md`
- PDF 可见页清晰度实施计划：`docs/superpowers/plans/2026-09-04-pdf-visible-page-sharpness-plan.md`

- 翻译输出协议与能力配置：`docs/superpowers/specs/2026-09-04-translation-output-capabilities-design.md`
- 翻译输出能力实施计划：`docs/superpowers/plans/2026-09-04-translation-output-capabilities-plan.md`

- 百炼 Qwen 翻译结构化输出加固：`docs/superpowers/specs/2026-09-04-qwen-translation-structured-output-design.md`
- 百炼 Qwen 翻译结构化输出实施计划：`docs/superpowers/plans/2026-09-04-qwen-translation-structured-output-plan.md`
- arXiv PDF 标识缓存与快速恢复：`docs/superpowers/specs/2026-09-03-arxiv-pdf-identity-cache-fast-restore-design.md`
- arXiv PDF 标识缓存与快速恢复实施计划：`docs/superpowers/plans/2026-09-03-arxiv-pdf-identity-cache-fast-restore-plan.md`
- PDF 工作台夜间主题与原稿柔和暗化：`docs/superpowers/specs/2026-09-03-pdf-night-theme-soft-dimming-design.md`
- PDF 工作台夜间主题与原稿柔和暗化实施计划：`docs/superpowers/plans/2026-09-03-pdf-night-theme-soft-dimming-plan.md`
- PDF 紧凑对译布局与缩放清晰度：`docs/superpowers/specs/2026-09-03-pdf-compact-reading-layout-canvas-clarity-design.md`
- PDF 紧凑对译布局与缩放清晰度实施计划：`docs/superpowers/plans/2026-09-03-pdf-compact-reading-layout-canvas-clarity-plan.md`
- PDF 长文档按需翻译与性能优化：`docs/superpowers/specs/2026-09-03-pdf-long-document-on-demand-performance-design.md`
- PDF 长文档按需翻译与性能优化实施计划：`docs/superpowers/plans/2026-09-03-pdf-long-document-on-demand-performance-plan.md`
- PDF 工作台现代化与易用性收口：`docs/superpowers/specs/2026-07-23-pdf-ui-polish-design.md`
- PDF 工作台现代化与易用性收口实施计划：`docs/superpowers/plans/2026-07-23-pdf-ui-polish-plan.md`
- PDF 大文件源字节生命周期：`docs/superpowers/specs/2026-07-23-pdf-large-source-lifecycle-design.md`
- PDF 大文件源字节生命周期实施计划：`docs/superpowers/plans/2026-07-23-pdf-large-source-lifecycle-plan.md`
- PDF 现代编辑型极简界面：`docs/superpowers/specs/2026-07-14-pdf-modern-editorial-ui-design.md`
- PDF 现代编辑型极简界面实施计划：`docs/superpowers/plans/2026-07-14-pdf-modern-editorial-ui-plan.md`
- PDF 表格与图片标题翻译及占位渲染：`docs/superpowers/specs/2026-07-13-pdf-media-caption-placeholder-design.md`
- PDF 表格与图片标题翻译及占位渲染实施计划：`docs/superpowers/plans/2026-07-13-pdf-media-caption-placeholder-plan.md`
- PDF MinerU 标题层级与独立公式修复：`docs/superpowers/specs/2026-07-13-pdf-mineru-heading-formula-design.md`
- PDF MinerU 标题层级与独立公式修复实施计划：`docs/superpowers/plans/2026-07-13-pdf-mineru-heading-formula-plan.md`
- PDF 富文本渲染、Agent 流式回答与区块联动：`docs/superpowers/specs/2026-07-12-pdf-rich-rendering-agent-stream-block-interaction-design.md`
- PDF 富文本渲染、Agent 流式回答与区块联动实施计划：`docs/superpowers/plans/2026-07-12-pdf-rich-rendering-agent-stream-block-interaction-plan.md`
- PDF 单主滚动与逐页配对布局：`docs/superpowers/specs/2026-07-12-pdf-single-scroll-paired-pages-design.md`
- PDF 单主滚动与逐页配对布局实施计划：`docs/superpowers/plans/2026-07-12-pdf-single-scroll-paired-pages-plan.md`
- arXiv 论文离线界面外在线全链路验收：`docs/superpowers/specs/2026-07-12-arxiv-live-pipeline-verification-design.md`
- arXiv 论文离线界面外在线全链路验收实施计划：`docs/superpowers/plans/2026-07-12-arxiv-live-pipeline-verification-plan.md`
- LLM 流式翻译与空闲超时：`docs/superpowers/specs/2026-07-12-llm-streaming-idle-timeout-design.md`
- LLM 流式翻译与空闲超时实施计划：`docs/superpowers/plans/2026-07-12-llm-streaming-idle-timeout-plan.md`
- PDF 翻译失败诊断与滚动渲染稳定性：`docs/superpowers/specs/2026-07-12-pdf-translation-diagnostics-render-stability-design.md`
- PDF 翻译失败诊断与滚动渲染稳定性实施计划：`docs/superpowers/plans/2026-07-12-pdf-translation-diagnostics-render-stability-plan.md`
- PDF 逐页等高滚动与顺序翻译：`docs/superpowers/specs/2026-07-12-pdf-page-aligned-scroll-sequential-translation-design.md`
- PDF 逐页等高滚动与顺序翻译实施计划：`docs/superpowers/plans/2026-07-12-pdf-page-aligned-scroll-sequential-translation-plan.md`
- LLM 默认模型与翻译诊断重构：`docs/superpowers/specs/2026-07-12-llm-default-model-translation-diagnostics-design.md`
- LLM 默认模型与翻译诊断实施计划：`docs/superpowers/plans/2026-07-12-llm-default-model-translation-diagnostics-plan.md`
- LLM 双任务模型与思考配置：`docs/superpowers/specs/2026-07-12-llm-task-profiles-reasoning-design.md`
- Provider 独立连接测试：`docs/superpowers/specs/2026-07-12-provider-connection-tests-design.md`
- 网页翻译与 PDF 工作台总体设计：`docs/superpowers/specs/2026-07-11-web-translation-chrome-extension-design.md`

## 执行效率

- 默认按“相关任务批量实现、里程碑统一复核”推进。除 PDF 接管、权限、安全、数据迁移等高风险任务外，不为每个机械小任务单独启动完整复核。
- 同一共享工作树中不得并行运行多个实现任务；可并行准备只读资料或执行独立审查，避免文件冲突和重复构建。
- 子任务简报必须写清精确文件路径、公开接口、硬约束和验收命令。发现计划示例与现有架构冲突时，先修正规格或计划，再写实现。
- 遇到浏览器原生权限弹窗、action Popup 等自动化工具不可见边界，只允许一次有证据的可行性尝试。确认工具边界后立即转为明确的人工验收门禁，不反复探索规避方案。

## 测试分层

- TDD 开发循环只运行受影响的定向测试。禁止每完成一个函数或小修复就运行 `npm run check` 或完整 E2E。
- 实现者提交里程碑前运行相关定向测试、类型检查和必要构建；完整 `npm run check` 与相关 E2E 原则上由控制器在复核与必要修复全部完成后各运行一次最终门禁。
- 独立 reviewer 默认只读审查，不重复报告中已经有明确命令和结果的全量测试。只有发现具体可疑路径时才运行最小复现测试。
- reviewer 的 Critical/Important 问题合并为一个 fix wave，一次性补回归测试和修复；fix wave 内只跑定向测试，所有问题关闭后再跑一次完整门禁。
- 没有代码变化时不得重复同一条全量命令。需要重复时，先说明前一次证据为何已失效。
- E2E 按里程碑运行，不按小任务运行。授权后的自动化路径必须明确标注，不能冒充真实 action Popup、`activeTab` 或原生权限弹窗验收。

## 测试性能

- 纯逻辑、Provider、消息校验和缓存测试优先使用 `node` 环境；只有 DOM、React、内容脚本相关测试使用 `jsdom`，避免所有测试文件重复初始化浏览器 DOM。
- Windows 下全量 Vitest 固定最多 4 个 worker，避免默认按 CPU 数扩张导致无诊断退出；不要为单次定向测试另行降到单 worker。
- 单条全量命令超过 30 秒时记录主要阶段耗时，优先定位 Vitest 环境初始化、TypeScript 冷启动、WXT 构建或 Chromium 启动，不把“npm 慢”作为笼统结论。
- 保留完整 `check` 作为发布门禁，同时优先提供并使用定向测试或 `check:fast` 作为开发反馈。不得通过删除关键断言、跳过安全测试或降低 E2E 真实性来换取速度。

## 质量复核

- 每个里程碑只安排一次独立复核；修复后由同一 reviewer 聚焦复核原问题，避免重新做无边界的全量审查。
- Critical 和 Important 必须修复并复核关闭。Minor 记录到实施报告或进度账本，除非修复成本很低或会明显影响用户数据、页面行为与可访问性，否则不触发新的全量循环。
- reviewer 建议必须先与代码、浏览器实际行为和已批准设计核验。审查建议若被真实 E2E 证伪，应修正建议而不是绕过 E2E。
- 任何完成、通过或 Ready 声明必须引用当前提交上的新鲜验证结果；不得仅依赖子智能体口头汇报。
