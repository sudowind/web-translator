# 百炼 Qwen 翻译结构化输出实施计划

日期：2026-09-04  
状态：历史里程碑完成；后续按通用能力配置计划替代模型/域名白名单

当前计划见 `docs/superpowers/plans/2026-09-04-translation-output-capabilities-plan.md`。

## 单一里程碑

1. 先补 `tests/unit/providers/openai/request-builder.test.ts` 和 `client.test.ts` 回归，确认旧实现不能提供严格 Schema 和完整字段模板。
2. 在 `src/providers/openai/translation-format.ts` 集中声明输出契约和能力范围；接入 `request-builder.ts` 与 `client.ts`。
3. 为 `translation-response.test.ts` 补充常见结构偏差拒绝用例，保留现有 ID 校验。
4. 运行受影响 Provider、设置测试和类型检查。
5. 按 AGENTS.md 安排一次独立只读复核；统一修复 Important/Critical，定向复核关闭。
6. 最后统一执行 `npm run check` 和 `npm run test:e2e`，记录结果与真实接口未测试边界。构建产物供用户重载扩展验收，不主动读取或使用 API Key。

## 完成记录

以上六项已完成。完整检查 61 个测试文件、418 项测试通过；E2E 12 项通过、1 项真实网络样本按默认配置跳过。独立复核无待修问题。详见 `docs/superpowers/reports/2026-09-04-qwen-translation-structured-output-report.md`。
