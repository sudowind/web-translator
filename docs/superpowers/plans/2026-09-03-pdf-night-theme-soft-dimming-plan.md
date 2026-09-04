# PDF 工作台夜间主题与原稿柔和暗化实施计划

日期：2026-09-03  
状态：已完成

## 目标

实现 `docs/superpowers/specs/2026-09-03-pdf-night-theme-soft-dimming-design.md`，在不重绘 PDF、不影响文本层和高亮层的前提下完成三档主题切换。

## 任务 1：主题状态与系统监听

- 新增 `web-translate-plugin/src/pdf/theme.ts`。
- 定义主题偏好、解析结果、存储键和类型守卫。
- 从 `chrome.storage.local` 读取并持久化偏好。
- 监听 `prefers-color-scheme` 与扩展存储变化。
- 接管页面时同步设置初始系统主题，关闭工作台时清理根元素属性。

验收：纯逻辑测试和 Hook 测试覆盖三档解析、运行时系统切换、手动固定与持久化。

## 任务 2：工具栏切换入口

- 扩展 `WorkspaceToolbarProps`，由 `PdfWorkspace` 持有主题 Hook 返回值。
- 在“更多操作”菜单增加“外观”分组。
- 使用三个 `menuitemradio` 表达跟随系统、浅色和深色。

验收：组件测试验证选项顺序、`aria-checked` 和回调值。

## 任务 3：语义配色与 Canvas 暗化

- 把工作台现有硬编码状态色收敛为浅色语义变量。
- 增加深色变量覆盖，包含表面、文字、边界、焦点、错误、代码和滚动条。
- 仅对 PDF Canvas 应用柔和暗化变量。
- 在减少动态效果时取消 Canvas 主题过渡。

验收：样式契约测试证明深色变量存在、Canvas 使用滤镜、外层容器没有滤镜。

## 任务 4：真实链路与视觉门禁

- 扩展 `tests/e2e/pdf-workspace.spec.ts`。
- 验证深色滤镜、浅色恢复和运行时系统主题变化。
- 新增 `pdf-workspace-dark-win32.png` 视觉基线。
- 运行定向单元测试、类型检查、生产构建和 PDF E2E。

验收：所有命令在 `codex/pdf-night-mode` 独立 worktree 当前提交上通过。
