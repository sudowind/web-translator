# LLM 默认模型与翻译诊断重构设计

## 背景与问题

当前设置把 `translation.model` 同时用于快速连通测试和正式翻译，但页面把“翻译模型”放在基础连接区域之后。用户在基础区域看不到快速连通依赖的模型，也无法理解为什么必须先填写下方翻译配置。

翻译配置测试还有第二个问题：HTTP 请求成功后，响应仍可能因为不是严格 JSON、JSON 结构不匹配或 block ID 契约不成立而失败。这些校验目前抛出普通 `Error`，上层无法识别阶段，只能折叠为 `PROVIDER_ERROR`，并错误提示用户检查 Endpoint、模型和 API Key。

## 目标

- 基础连接区域明确包含快速连通测试所需的模型。
- 页面概念与持久化数据结构一致，不再让 `translation.model` 暗中承担“默认模型”职责。
- 翻译与智能体默认使用基础默认模型，智能体仍可选择独立模型。
- 翻译测试区分“请求未成功”和“请求成功但输出契约不兼容”。
- 不记录或展示 API Key、Authorization、请求头和模型响应正文。
- 旧配置自动迁移，用户无需重新填写现有 Endpoint、Key 或模型。

## 方案选择

### 采用：单一默认模型加智能体覆盖

基础区域配置 `defaultModel`。快速连通和翻译使用默认模型；论文智能体默认继承默认模型，也可关闭继承并配置独立模型。

这一方案符合当前实际产品需求：翻译需要一个稳定模型，智能体可能需要更强模型。它消除隐藏依赖，同时避免为初版增加“连接模型、翻译模型、智能体模型”三套选择。

### 不采用：三个完全独立模型

完全独立最灵活，但会增加重复输入、迁移规则和测试矩阵。当前没有单独配置“仅用于连接测试的模型”的实际需求。

### 不采用：只移动输入框

只把翻译模型输入框移到基础区域可以快速改善页面，但内部仍保留 `translation.model` 兼任默认模型的错误语义，后续维护容易再次产生错位。

## 配置模型

重构后的核心结构：

```ts
export interface TranslationProfile {
  reasoning: { mode: 'off' };
  timeoutMs: number;
}

export interface OpenAiSettings {
  apiKey: string;
  baseUrl: string;
  dialect: ProviderDialect;
  defaultModel: string;
  translation: TranslationProfile;
  agent: {
    inheritDefaultModel: boolean;
    profile: ModelProfile;
  };
}
```

约束：

- `defaultModel` 为必填。
- 快速连通固定使用 `defaultModel`。
- 网页与 PDF 翻译固定使用 `defaultModel`。
- 智能体在 `inheritDefaultModel=true` 时使用 `defaultModel`，否则使用 `agent.profile.model`。
- 翻译缓存键使用 `defaultModel`。
- 翻译仍固定关闭思考，超时范围保持 5–120 秒。

## 设置页信息架构

### LLM 基础连接

按以下顺序展示：

1. Provider 类型。
2. Endpoint。
3. API Key。
4. 默认模型。
5. “测试快速连通”按钮。

帮助文本明确说明：“默认模型用于快速连通和翻译；论文智能体可在下方改用独立模型。”

### 翻译配置

不再重复显示模型输入框，改为只读摘要“模型：使用上方默认模型”，并展示：

- 思考模式：固定关闭。
- 翻译超时。
- “测试翻译配置”按钮。

### 论文智能体配置

- 复选框文案改为“使用默认模型”。
- 关闭继承时显示智能体模型输入框。
- 思考模式、Provider 专用参数和超时保持现有设计。
- “测试智能体配置”按钮保持独立。

## 翻译响应解析与错误语义

### 可接受响应

客户端接受两种内容：

1. 直接返回的 JSON Object 字符串。
2. 仅由单层 Markdown `json` 代码围栏包裹的 JSON Object。

去除围栏后仍执行完整 JSON 解析和严格 block ID 校验。不得从自然语言中搜索或截取任意花括号片段，避免把不确定输出误判为可靠翻译。

### 稳定错误码

- `TRANSLATION_HTTP_<status>`：HTTP 非成功状态。
- `TRANSLATION_TIMEOUT`：请求超时。
- `TRANSLATION_NETWORK`：网络失败。
- `TRANSLATION_RESPONSE_INVALID`：Chat Completions 外层响应缺少文本内容。
- `TRANSLATION_JSON_INVALID`：模型文本不是可接受 JSON。
- `TRANSLATION_SCHEMA_INVALID`：JSON 缺少合法 `translations` 数组或元素字段。
- `TRANSLATION_ID_UNKNOWN`：响应包含未知 block ID。
- `TRANSLATION_ID_DUPLICATE`：响应包含重复 block ID。
- `TRANSLATION_ID_MISSING`：响应缺少请求中的 block ID。

错误对象只携带稳定错误码，不携带响应正文。

### 设置页提示

当 HTTP 已成功但输出契约失败时，提示：

> 接口连接成功，但模型输出不符合翻译格式要求（错误码：…）。请确认模型支持 JSON Object 输出，或更换适合结构化翻译的模型。

此时不得提示用户检查 API Key 或 Endpoint。

HTTP、网络和鉴权失败继续提示检查连接配置，并显示 Provider、HTTP 状态和安全错误码。

## 迁移

读取设置时兼容以下来源：

- 旧单模型结构：`model` 迁移到 `defaultModel`。
- 当前双任务结构：`translation.model` 迁移到 `defaultModel`。
- `agent.inheritTranslationModel` 迁移到 `agent.inheritDefaultModel`。
- 智能体独立模型、思考参数和超时原样保留。

写入时只保存新结构。部分损坏的新旧配置继续逐字段回退默认值，确保设置页可自救。

## 安全与真实接口验证

- 用户不得把 API Key 发到聊天、测试代码、日志或仓库。
- 真实 Key 仅由用户填写到扩展设置页并保存在扩展本地存储。
- 自动化测试使用模拟 Provider，不依赖真实 Key。
- 真实接口人工验收只记录测试阶段、Provider、HTTP 状态和稳定错误码。
- Chrome 安全策略禁止自动控制扩展内部页面时，保留人工点击门禁，不尝试绕过。

## 测试策略

- 设置迁移：旧 `model` 与当前 `translation.model` 都迁移到 `defaultModel`。
- 请求构造：三类调用选择正确模型。
- 翻译解析：直接 JSON、单层 `json` 围栏成功。
- 翻译解析：自然语言、损坏 JSON、错误 schema、未知/重复/缺失 ID 分别产生稳定错误码。
- 测试提示：HTTP 成功后的契约错误不得提示检查 Key 或 Endpoint。
- UI：默认模型位于基础区域；翻译区域不出现第二个模型输入框；智能体显示“使用默认模型”。
- 回归：网页翻译、PDF 翻译、翻译缓存键和论文智能体。

## 验收标准

1. 用户只看基础区域就能理解快速连通使用哪个模型。
2. 快速连通和翻译都使用 `defaultModel`，智能体可继承或覆盖。
3. 现有配置升级后 Endpoint、Key、翻译模型和智能体设置不丢失。
4. 单层 JSON 代码围栏不会导致翻译测试误报失败。
5. HTTP 成功但格式不兼容时，页面明确报告输出契约问题，不显示 `PROVIDER_ERROR`。
6. 错误与日志不泄露 Key、请求头或响应正文。
7. 类型检查、单元测试、生产构建以及网页/PDF E2E 通过。
