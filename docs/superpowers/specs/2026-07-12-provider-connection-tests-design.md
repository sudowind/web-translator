# Provider 独立连接测试设计

## 背景与问题

设置页当前只有一个“测试连接”按钮，但后台实际上只调用 LLM 的 Chat Completions。MinerU 配置只参与格式校验和 Origin 授权，未发起任何 MinerU 请求。因此 LLM 返回的 404 会被用户误认为 MinerU 连接失败。

此外，MinerU 地址当前允许保留任意路径。若用户把文档页 `https://mineru.net/apiManage/docs` 填入接口地址，正式解析时会拼接成错误路径并返回 404。

## 目标

- LLM 与 MinerU 使用独立操作、独立加载状态和独立反馈。
- 任何错误都明确标注来自 LLM 或 MinerU。
- MinerU 的常规配置检查不创建解析任务、不消耗解析额度。
- MinerU 真实连接测试必须由用户明确确认其会提交官方示例文件并可能消耗额度。
- MinerU 精准解析 API 地址必须是 HTTPS Origin 根地址，不接受文档页或其他路径。

## 交互设计

设置页保留一个表单，但把 Provider 分为两个语义清晰的区域。

### LLM 区域

- 字段标题改为“LLM 接口地址”“LLM 模型”“LLM API Key”。
- 提供“测试 LLM”按钮。
- 测试仍发送最小翻译请求，但反馈只显示在 LLM 区域，例如：
  - `LLM：连接成功`
  - `LLM：请求失败（HTTP 404），请检查接口根地址是否包含 /v1`
- 测试期间只禁用 LLM 测试按钮及相关重复操作，不把 MinerU 状态显示为失败。

### MinerU 区域

- “MinerU 接口地址”帮助文本明确要求填写 `https://mineru.net`，不得填写文档地址。
- 提供“检查 MinerU 配置”按钮。它只执行：字段格式、根地址、Token 非空、模型版本和精确 Origin 权限检查，不调用解析 API。
- 成功反馈为：`MinerU：配置与权限已就绪，尚未创建解析任务`。
- 后续可提供“真实测试 MinerU”按钮；点击后必须先显示确认说明，明确将提交官方示例 PDF、目标服务和可能消耗额度。用户确认后才调用官方 `/api/v4/extract/task`。本次优化不实现真实测试，避免引入静默额度消耗和对外部示例资源的依赖。

### 保存

- “保存设置”继续统一保存完整配置，并按配置申请 LLM 与 MinerU 的精确 Origin 权限。
- 保存成功不等同于连接成功；反馈使用“设置已保存”，不使用“连接成功”。
- LLM 是网页翻译、PDF 译文和论文问答的必需配置；MinerU 是 PDF 解析的必需配置。字段帮助文字应明确这一点。

## 校验与错误边界

- LLM 地址允许 OpenAI 兼容 API 路径，例如 `https://api.example.com/v1`。
- MinerU 地址必须满足：HTTPS、无用户名密码、无 query、无 fragment、pathname 为空或仅 `/`。保存时规范化为 URL Origin，例如 `https://mineru.net`。
- MinerU Token 由插件在请求时自动添加 `Bearer `，用户只填写原始 Token。
- 页面不得显示 Token、API Key、Authorization 或 Provider 原始响应正文。
- HTTP 错误只显示 Provider 名称、状态码和可操作建议。

## 代码边界

- `src/settings/provider-access.ts`：增加 MinerU 根地址规范化与校验。
- `src/settings/test-provider.ts`：把现有测试消息收窄为 LLM 测试；新增不发网络请求的 MinerU 配置检查消息/函数，或使用一个带 Provider 判别字段的精确消息联合。
- `entrypoints/options/App.tsx`：分别维护 LLM/MinerU 活动状态和反馈，使用独立按钮及就近 `aria-live="polite"` 状态。
- 对应单元测试覆盖消息精确校验、错误归属、MinerU 根地址拒绝、无网络配置检查和旧设置兼容。

## 验收标准

1. LLM 返回 404 时，界面明确显示“LLM 请求失败”，MinerU 状态不改变。
2. `https://mineru.net` 可保存并规范化；`https://mineru.net/apiManage/docs`、带 query/fragment 或凭据的地址被就近拒绝。
3. “检查 MinerU 配置”不调用 fetch、不创建解析任务，成功文案明确“尚未创建解析任务”。
4. 两个按钮有独立加载/禁用状态，键盘可操作，反馈由屏幕阅读器宣布。
5. 保存、普通网页翻译、PDF 解析和既有 Provider 权限逻辑无回归。

## 非目标

- 本次不增加后端服务。
- 本次不实现免额度的 MinerU Token 查询，因为官方文档未提供可依赖的独立健康检查端点。
- 本次不通过伪造 task id、依赖未文档化的 404/401 差异来判断 Token 是否有效。
