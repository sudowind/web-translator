# 百炼 Qwen 翻译结构化输出加固报告

日期：2026-09-04  
状态：历史验证记录；模型/域名白名单随后由通用能力配置取代

以下结果仅对应最初 Qwen 补丁，不代表当前工作区最终验证；当前结果见 `docs/superpowers/reports/2026-09-04-translation-output-capabilities-report.md`。

## 结果与范围

- 所有翻译提示词明确声明 `translations` 数组、字符串 `id`/`text`、一输入块一输出项，禁止更换字段名和额外包装；保留 Markdown、公式与媒体标题规则。
- 百炼北京官方兼容 endpoint、`dashscope` 方言、精确模型名 `qwen3.8-max` 的翻译请求启用 `json_schema`、`strict: true`，根对象及元素关闭额外字段。
- 未确认的模型、地区、代理与方言继续使用 JSON Object。连接测试和智能体不新增 response_format；翻译维持流式与关闭思考。
- 不宽松接受错误字段、不推测 ID、不自动重复调用模型；未增加响应正文日志或诊断中的敏感内容。用户专属工作空间地址未写入代码。
- 没有改变缓存结构或清除成功译文；升级后重试失败页即可使用新请求协议。

## 证据

- 先运行新增协议回归，旧实现 3 项失败：缺少严格 Schema（两种官方北京 endpoint）及显式字段模板。
- 实现后 8 个定向测试文件、81 项测试通过；TypeScript 类型检查通过。
- 能力依据为 [百炼结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output) 的 JSON Schema 支持列表和北京 `qwen3.8-max` 官方示例（2026-09-04 核对）。
- 独立只读复核完成：无 Critical、Important 或需本轮修复的 Minor；未重复运行全量测试或真实付费请求。
- 在 `web-translate-plugin` 执行 `npm run check`：类型检查、61 个测试文件 / 418 项测试、生产构建与产物验证全部通过。Vitest 耗时 17.24 秒，WXT 构建耗时 3.656 秒；产物验证 Unicode noncharacter=0、静态 host 权限=0、静态 content script=0。
- 同一实现工作区执行 `npm run test:e2e`：12 项通过、1 项按默认配置跳过，耗时 49.7 秒。跳过项为需显式启用的真实 arXiv 网络样本；其余覆盖授权后 PDF 接管、工作台、长文档、缓存恢复、失败诊断、上传同意及网页翻译路径，不代表原生权限弹窗或 action Popup 验收。
- 自动化验证对应 `dev` 上本次未提交修改；生成的 `.output/chrome-mv3` 可供重载扩展。验证后仅补充中文文档，不改实现。

## 人工验收边界

本次未读取用户 API Key，未向真实百炼 endpoint 发送付费请求。请求构造和响应解析使用模拟 SSE 验证，不能声称已复现并消除真实模型的全部异常输出。官方文档未单独说明严格 Schema 的流式组合行为，仍需用户在现有 endpoint 上确认。

重载扩展后，在设置中确认 Provider 为“阿里云百炼 / DashScope”、模型为 `qwen3.8-max`，保持现有北京官方 endpoint，运行翻译能力测试并重试失败页。无需清理整篇解析缓存。若仍报错，应进一步检查脱敏错误码与返回字段结构，不索取 API Key 或完整文档。
