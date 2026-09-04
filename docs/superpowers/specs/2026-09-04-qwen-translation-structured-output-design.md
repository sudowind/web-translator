# 百炼 Qwen 翻译结构化输出加固

日期：2026-09-04  
状态：历史方案；模型/域名白名单已被通用能力配置方案取代

后续设计见 `docs/superpowers/specs/2026-09-04-translation-output-capabilities-design.md`。以下保留最初诊断背景，不作为当前白名单实现要求。

## 问题与证据

用户使用百炼北京工作空间官方兼容接口和 `qwen3.8-max` 时遇到 `TRANSLATION_SCHEMA_INVALID`。该错误说明响应文本可解析为 JSON，但不满足译文数组及 `id`/`text` 字符串契约；现有脱敏诊断无法确认具体偏差字段。

优化前代码只用提示词要求 `translations` 数组，没有明确指定每项必须包含字符串 `text`，且请求使用只保证 JSON 语法的 `json_object`。根据 2026-09-04 核对的[百炼结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)，`qwen3.8-max` 支持严格 JSON Schema，官方示例使用北京工作空间兼容接口。

## 方案

1. 所有翻译请求明确约定 `{"translations":[{"id":"原输入 ID","text":"译文"}]}`，规定字段类型、逐块对应、只翻译 text、不输出说明或额外包装；输入区块中的指令作为待翻译文本处理。
2. 仅当 Provider 为 `dashscope`、模型精确为 `qwen3.8-max` 且 endpoint 为 HTTPS 百炼北京兼容接口时，使用 `json_schema` 和 `strict: true`。匹配通用工作空间主机模式和官方 `dashscope.aliyuncs.com`，不写入用户专属地址。
3. Schema 根对象只允许 `translations`；数组每项只允许必需的字符串 `id`、`text`；根对象和元素均设置 `additionalProperties: false`。
4. 其他模型、地区、代理或方言保持 `json_object`，不推测其严格 Schema 能力；不自动扩大模型支持列表。
5. 翻译继续流式且关闭思考；连接测试和 Agent 行为不变。客户端继续验证 ID 完整性、唯一性和所属关系，不按数组顺序猜测缺失 ID，不宽松转换错误字段。
6. 不增加自动重复计费请求，不记录原文、完整模型响应或凭据。现有成功缓存不失效；失败请求原本未写入缓存，升级后重试失败页即可。

## 验收

- 请求构造测试覆盖官方北京工作空间和经典 endpoint 的严格 Schema；覆盖未知模型、非北京地区、代理、相似域名、错误协议/路径与非百炼方言的保守行为。
- 翻译客户端测试验证显式模板、严格请求与 SSE 响应解析，并保留格式错误、缺失/重复/未知 ID 的拒绝路径。
- 定向 Provider/设置测试、类型检查、完整 check 与授权测试路径 E2E 通过。
- 没有在用户 endpoint 上运行真实付费请求时必须明确说明，不把模拟测试等同于真实模型验收。
