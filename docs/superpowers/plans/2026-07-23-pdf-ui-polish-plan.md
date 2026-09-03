# PDF 工作台现代化与易用性收口实施计划

状态：已完成（2026-07-23）

## 任务

- [x] 为工具栏跳页、缩放反馈、受控更多菜单补充组件测试。
- [x] 为智能体空状态、建议问题和稳定三段布局补充组件与样式测试。
- [x] 为 44px 热区、60px 单行工具栏、窄屏偏移和状态按钮补充样式契约测试。
- [x] 为响应头标题和通用下载地址回退补充 PDF 源测试。
- [x] 实现工具栏上一页、下一页、直接跳页、缩放百分比和受控更多菜单。
- [x] 实现智能体稳定视口高度、空状态和建议问题。
- [x] 实现窄屏单行工具栏、44px 热区和覆盖层正确偏移。
- [x] 统一加载、上传同意、失败恢复和滚动条样式。
- [x] 改进 PDF 标题解析。
- [x] 运行 PDF 定向测试、类型检查和视觉 E2E。
- [x] 更新实施报告并运行最终门禁。

## 验收命令

```powershell
npx vitest run tests/unit/pdf/workspace-toolbar.test.tsx tests/unit/pdf/agent-panel.test.tsx tests/unit/pdf/pdf-styles.test.ts tests/unit/pdf/pdf-source.test.ts --maxWorkers=4
npm run typecheck
npm run build
npm run test:e2e -- pdf-workspace.spec.ts
npm run check
```
