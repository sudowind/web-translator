# LLM 双任务模型与思考配置设计

## 背景

当前扩展的 LLM 配置只有一个 `model`，网页/PDF 翻译、连接测试和论文问答共用同一模型与请求方式。翻译客户端固定要求 JSON 结构化输出，论文问答则需要更强的推理能力；连接测试又应追求最短响应时间。三类调用继续共用同一请求策略会导致以下问题：

- 混合思考模型可能默认开启思考，使连接测试和翻译明显变慢。
- 百炼明确限制 JSON 结构化输出与开启思考同时使用。
- 不同 Provider 使用不同思考参数，无法用一个全局布尔值可靠表达。
- 用户可能希望使用低成本模型翻译，使用更强模型回答论文问题。

## 目标

- LLM Endpoint 与 API Key 继续统一配置。
- 翻译模型与论文问答模型分别配置；问答模型默认继承翻译模型。
- 思考参数按 Provider 协议映射，不依赖脆弱的模型名称推断。
- 连接测试、翻译和问答具有不同且明确的请求策略。
- 旧版单模型设置自动迁移，不要求用户重新填写凭据。
- 首期保留一次性问答响应；真正流式问答作为独立后续迭代。

## 方案选择

### 不采用：全局思考开关

全局开关无法同时满足翻译的低延迟/结构化输出和论文问答的推理需求。翻译开启思考还可能直接触发 Provider 协议错误。

### 不采用：根据 Endpoint 完全自动推断

代理域名、自建网关和兼容服务可能隐藏真实 Provider。完全自动推断会发送错误的厂商专用参数。

### 采用：显式 Provider 类型与按任务配置

设置页根据常见 Endpoint 自动预选 Provider 类型，但用户可以手动覆盖。翻译与问答使用独立 `ModelProfile`，请求统一经过 Provider 能力映射器。

## 配置模型

```ts
export type ProviderDialect =
  | 'openai'
  | 'dashscope'
  | 'minimax'
  | 'generic-openai';

export type ReasoningMode = 'off' | 'auto' | 'on';
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ReasoningSettings {
  mode: ReasoningMode;
  effort?: ReasoningEffort;
  budgetTokens?: number;
}

export interface ModelProfile {
  model: string;
  reasoning: ReasoningSettings;
  timeoutMs: number;
}

export interface OpenAiSettings {
  apiKey: string;
  baseUrl: string;
  dialect: ProviderDialect;
  translation: ModelProfile;
  agent: {
    inheritTranslationModel: boolean;
    profile: ModelProfile;
  };
}
```

默认值：

- `dialect`：根据 Endpoint 预选；无法识别时为 `generic-openai`。
- 翻译：思考 `off`，超时 30 秒。
- 论文问答：继承翻译模型，思考 `auto`，超时 120 秒。
- 百炼 `budgetTokens` 默认留空，表示使用模型默认预算。
- OpenAI `effort` 默认 `medium`。

## Provider 类型与参数映射

### 百炼 OpenAI 兼容

- `off`：发送 `enable_thinking: false`。
- `auto`：不发送思考参数，使用模型默认值。
- `on`：发送 `enable_thinking: true`。
- `on` 且填写思考 Token 上限：额外发送 `thinking_budget`。
- 不把低/中/高武断映射为固定 Token 数，避免超过不同模型的预算范围。

### OpenAI 标准

- `off`：不请求 reasoning。
- `auto`：不发送 reasoning 参数。
- `on`：根据用户选择发送 `reasoning_effort: low | medium | high`，具体字段由适配器集中维护。

### MiniMax 兼容

- `off`：发送 `thinking: { type: 'disabled' }`。
- `auto`：发送 `thinking: { type: 'adaptive' }`。
- 首期不提供额外强度配置。

### 通用 OpenAI 兼容

- `off` 与 `auto` 均不发送厂商专用思考参数。
- `on` 禁用并提示“无法确认该兼容接口支持的思考协议”。
- 首期不允许用户填写任意 `extra_body` JSON，避免不可验证参数和安全风险。

## 三类调用策略

### 连接测试

- 使用翻译模型。
- 强制关闭思考，不受问答配置影响。
- 不复用正式批量翻译请求，不要求 JSON 结构化输出。
- 请求最短回答，限制输出长度，15 秒超时。
- 错误明确显示 Provider、HTTP 状态和安全的错误代码，不显示响应原文、API Key 或 Authorization。

### 网页与 PDF 翻译

- 使用翻译模型。
- 思考模式固定为 `off`。
- 保留 `response_format: { type: 'json_object' }` 和严格块 ID 校验。
- 超时默认 30 秒，继续使用既有有限重试和取消机制。
- 首期不允许用户为翻译开启思考；设置页说明结构化翻译与思考模式可能冲突。

### 论文问答

- 默认继承翻译模型；关闭继承后使用独立问答模型。
- 使用问答模型的思考模式与 Provider 专用参数。
- `auto` 表示不发送显式思考参数，遵循模型默认行为。
- 超时默认 120 秒，现有停止按钮继续使用独立 AbortController。
- 思考请求进行时显示“模型正在思考”，不伪造进度百分比。

## 统一请求构建边界

新增纯逻辑请求构建模块，客户端不得继续分别拼接厂商参数：

```ts
type LlmPurpose = 'connection-test' | 'translation' | 'agent';

interface ChatRequestInput {
  purpose: LlmPurpose;
  settings: OpenAiSettings;
  messages: Array<{ role: string; content: string }>;
}

interface BuiltChatRequest {
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}

buildChatRequest(input: ChatRequestInput): BuiltChatRequest;
```

构建器负责：

- 选择翻译或问答 Profile。
- 处理问答模型继承。
- 应用固定的连接测试和翻译策略。
- 根据 `dialect` 添加思考参数。
- 在网络请求前拒绝不支持的配置组合。

Provider 客户端只负责 URL、认证、fetch、Abort、响应格式校验和安全错误映射。

## 设置页设计

### Provider 基础区域

- Provider 类型选择器。
- Endpoint。
- API Key。
- 根据常见 Endpoint 自动预选类型；用户手动选择后不再自动覆盖。
- “快速测试 LLM 连接”按钮，只验证 Endpoint、Key、模型和最短 Chat 请求，固定关闭思考并使用 15 秒超时。

### 翻译配置区域

- 翻译模型。
- 只读状态“思考模式：关闭”。
- 超时设置，默认 30 秒，限制 5–120 秒。
- “测试翻译配置”按钮，真实验证 JSON 输出与块 ID 契约。

### 论文问答配置区域

- “继承翻译模型”复选框，默认选中。
- 未继承时显示问答模型字段。
- 思考模式：关闭、Provider 默认、开启。
- 百炼开启时显示可选 `thinking_budget` 数字字段。
- OpenAI 开启时显示思考强度低/中/高。
- MiniMax 只显示关闭/自适应。
- 通用兼容接口不允许选择开启。
- 超时设置，默认 120 秒，限制 15–300 秒。
- “测试问答配置”按钮；启用思考时明确提示响应可能较慢并产生额外 Token。

所有按钮独立显示加载状态；错误在对应区域就近展示，并使用 `aria-live="polite"`。交互目标保持至少 44px，键盘焦点清晰，禁用项同时提供文字原因而不只依赖颜色。

## 迁移与兼容

旧设置：

```ts
{ baseUrl, apiKey, model }
```

迁移为：

- `translation.model = old.model`
- `translation.reasoning.mode = 'off'`
- `translation.timeoutMs = 30_000`
- `agent.inheritTranslationModel = true`
- `agent.profile.model = old.model`
- `agent.profile.reasoning.mode = 'auto'`
- `agent.profile.timeoutMs = 120_000`
- 根据旧 `baseUrl` 推断 `dialect`，无法识别时使用 `generic-openai`

迁移只发生在设置读取边界，写入时始终保存新结构。缓存键必须继续使用实际翻译模型；问答不进入译文缓存。

## 错误处理

- Provider 不支持思考参数：发送前阻止并提示如何切换类型或模式。
- 翻译模型只支持思考：测试翻译配置时明确报告“不适合作为结构化翻译模型”。
- JSON 模式与思考冲突：翻译路径不发送思考参数，不进行静默重试。
- 思考预算非法：客户端校验正整数；Provider 返回上限错误时显示安全错误代码。
- 请求超时：分别标注“翻译测试超时”或“论文问答超时”。
- 用户停止：保留 AbortError 语义，不显示为 Provider 故障。

## 测试策略

- 设置迁移：旧单模型配置迁移为两个 Profile。
- Provider 推断：百炼、OpenAI、MiniMax、未知代理域名。
- 请求构建矩阵：三种 purpose × 四种 dialect × 三种 reasoning mode 的有效/无效组合。
- 连接测试：不带 JSON 模式、强制关闭思考、15 秒超时。
- 翻译：百炼发送 `enable_thinking:false`，保留 JSON 模式。
- 问答：百炼、OpenAI、MiniMax 参数正确；generic `on` 被拒绝。
- UI：继承开关、条件字段、禁用原因和独立状态。
- 回归：网页翻译、PDF 逐页翻译、论文问答和 Provider Origin 权限测试。

## 分阶段边界

本次实现配置模型、迁移、请求构建器、Provider 映射、独立测试和非流式问答状态。

真正的流式论文问答留作下一迭代：后台 fetch 解析 SSE，通过长期 `runtime.Port` 向内容脚本增量发送 reasoning/answer 事件，并覆盖断线、取消、重连和 Service Worker 生命周期。流式能力不阻塞本次思考配置交付。

## 验收标准

1. 旧配置加载后无需重新输入 Endpoint、Key 或模型。
2. 翻译和问答可以使用不同模型，问答默认继承翻译模型。
3. 百炼连接测试和翻译请求显式关闭思考，响应不再因默认思考无上限等待。
4. 问答可配置关闭、Provider 默认或开启思考，并显示对应的百炼预算/OpenAI 强度字段。
5. 通用兼容接口不会收到未知厂商参数。
6. 不支持的组合在发请求前给出明确、可操作的错误。
7. 类型检查、单元测试、生产构建和相关 E2E 通过。
