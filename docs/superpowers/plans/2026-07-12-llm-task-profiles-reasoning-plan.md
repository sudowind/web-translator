# LLM 双任务模型与思考配置实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施；所有步骤使用复选框跟踪。

**目标：** 为翻译和论文问答提供独立模型 Profile，并通过显式 Provider 类型安全映射思考模式、强度或预算，同时让连接测试强制关闭思考并快速完成。

**架构：** 设置层保存统一 Endpoint/Key、Provider 类型和两个任务 Profile；`request-builder.ts` 是唯一的模型选择与厂商参数映射边界；通用 Chat Transport 负责超时、认证、fetch 和内容读取，翻译与论文问答客户端只负责各自 Prompt 与结果解析。旧单模型设置在读取边界迁移。

**技术栈：** React 19、TypeScript、WXT、Chrome MV3、Vitest、Playwright。

## 全局约束

- 所有 plan/spec 使用中文。
- 翻译与连接测试必须关闭思考；论文问答才允许配置思考。
- 不允许任意 `extra_body` JSON。
- 通用 OpenAI 兼容类型不得收到未知厂商参数。
- 凭据、Authorization、Provider 原始响应和论文全文不得进入错误消息。
- 开发中只运行受影响的定向测试；最终只运行一次 `npm run check`、`webpage-translation.spec.ts` 和 `pdf-workspace.spec.ts`。
- 旧设置必须无损迁移；缓存键必须使用实际翻译模型。
- 本次不实现流式问答或 `runtime.Port`。

---

## 文件结构

- 修改 `web-translate-plugin/src/settings/schema.ts`：定义 Provider 类型、Reasoning、ModelProfile 与新 LLM 设置。
- 修改 `web-translate-plugin/src/settings/store.ts`：旧单模型设置迁移与新设置持久化。
- 修改 `web-translate-plugin/src/settings/provider-access.ts`：新结构校验、规范化和 Origin 授权。
- 创建 `web-translate-plugin/src/providers/openai/request-builder.ts`：按 purpose/Profile/dialect 生成请求体和超时。
- 创建 `web-translate-plugin/src/providers/openai/chat-client.ts`：统一 fetch、超时、Abort 与安全错误。
- 修改 `web-translate-plugin/src/providers/openai/client.ts`：翻译 Prompt/JSON 解析包装器。
- 修改 `web-translate-plugin/src/agent/client.ts`：问答 Prompt 包装器与“正在思考”状态所需配置。
- 修改 `web-translate-plugin/src/settings/test-provider.ts`：连接测试使用专用短请求。
- 修改 `web-translate-plugin/src/pdf/workspace-service.ts`：翻译缓存键和 Agent Profile 接线。
- 修改 `web-translate-plugin/entrypoints/options/App.tsx` 与 `style.css`：Provider 类型、两个 Profile 和条件字段。
- 修改 `tests/unit/settings/store.test.ts`、`provider-access.test.ts`、`test-provider.test.ts`、`options-provider-actions.test.tsx`、`tests/unit/providers/openai/client.test.ts`、新增的 builder/transport 测试、`tests/unit/agent/client.test.ts`、`tests/unit/pdf/workspace-service.test.ts`、README 和两个 E2E 文件。

### 任务 1：扩展设置模型并迁移旧配置

**文件：**

- 修改：`web-translate-plugin/src/settings/schema.ts`
- 修改：`web-translate-plugin/src/settings/store.ts`
- 修改：`web-translate-plugin/src/settings/provider-access.ts`
- 测试：`web-translate-plugin/tests/unit/settings/store.test.ts`
- 测试：`web-translate-plugin/tests/unit/settings/provider-access.test.ts`

**接口：**

- 产出：`ProviderDialect`、`ReasoningSettings`、`ModelProfile`、新版 `OpenAiSettings`。
- 产出：`inferProviderDialect(baseUrl): ProviderDialect`。
- 产出：`resolveAgentProfile(settings): ModelProfile`。
- 消费：现有 `getSettings()`、`saveSettings()` 与 Provider Origin 授权。

- [ ] **步骤 1：先写旧设置迁移失败测试**

在 `store.test.ts` 写入旧结构并断言：

```ts
await fakeBrowser.storage.local.set({
  'webpage-translation-settings': {
    openAi: {
      apiKey: 'key',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    },
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
  },
});

await expect(getSettings()).resolves.toMatchObject({
  openAi: {
    dialect: 'dashscope',
    translation: {
      model: 'qwen-plus',
      reasoning: { mode: 'off' },
      timeoutMs: 30_000,
    },
    agent: {
      inheritTranslationModel: true,
      profile: {
        model: 'qwen-plus',
        reasoning: { mode: 'auto', effort: 'medium' },
        timeoutMs: 120_000,
      },
    },
  },
});
```

- [ ] **步骤 2：运行迁移测试确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/store.test.ts
```

预期：旧设置仍返回单一 `model`，缺少 dialect/Profile。

- [ ] **步骤 3：实现新类型、默认值和迁移**

在 `schema.ts` 定义设计中的类型，并把默认 LLM 设置改为：

```ts
openAi: {
  apiKey: '',
  baseUrl: '',
  dialect: 'generic-openai',
  translation: {
    model: '',
    reasoning: { mode: 'off' },
    timeoutMs: 30_000,
  },
  agent: {
    inheritTranslationModel: true,
    profile: {
      model: '',
      reasoning: { mode: 'auto', effort: 'medium' },
      timeoutMs: 120_000,
    },
  },
}
```

在 `store.ts` 使用结构判断迁移，不修改存储中的旧对象后再返回：

```ts
export function migrateOpenAiSettings(value: unknown): OpenAiSettings {
  if (isNewOpenAiSettings(value)) return value;
  const legacy = readLegacyOpenAiSettings(value);
  return createOpenAiSettings({
    apiKey: legacy.apiKey,
    baseUrl: legacy.baseUrl,
    dialect: inferProviderDialect(legacy.baseUrl),
    translationModel: legacy.model,
  });
}
```

Endpoint 推断规则：

- `*.maas.aliyuncs.com` 或 `*.dashscope.aliyuncs.com` → `dashscope`
- `api.openai.com` → `openai`
- `api.minimax.chat` 或 `api.minimaxi.com` → `minimax`
- 其他 → `generic-openai`

- [ ] **步骤 4：写 Profile 解析与校验失败测试**

在 `provider-access.test.ts` 覆盖：

```ts
expect(resolveAgentProfile({
  ...settings,
  agent: { ...settings.agent, inheritTranslationModel: true },
})).toMatchObject({ model: settings.translation.model });

expect(() => validateProviderSettings({
  ...extensionSettings,
  openAi: {
    ...extensionSettings.openAi,
    dialect: 'generic-openai',
    agent: {
      inheritTranslationModel: false,
      profile: {
        model: 'agent-model',
        reasoning: { mode: 'on' },
        timeoutMs: 120_000,
      },
    },
  },
})).toThrow('通用 OpenAI 兼容接口无法确认思考协议');
```

- [ ] **步骤 5：实现 Profile 规范化与边界**

校验：

- 翻译 `reasoning.mode` 必须为 `off`。
- 翻译超时 5_000–120_000。
- 问答超时 15_000–300_000。
- 未继承时问答模型非空。
- 百炼 `budgetTokens` 若存在必须为 1–131_072 的安全整数。
- OpenAI `on` 时 effort 必须为 low/medium/high。
- generic `on` 直接拒绝。

- [ ] **步骤 6：运行设置测试确认 GREEN**

运行：

```powershell
npm test -- tests/unit/settings/store.test.ts tests/unit/settings/provider-access.test.ts
npm run typecheck
```

预期：迁移、校验和类型检查通过；其余旧调用方的类型错误允许留到任务 3 前修复，但不得提交无法编译的代码。因此任务 1 与任务 2 连续完成后统一提交。

### 任务 2：实现统一请求构建器与 Chat Transport

**文件：**

- 创建：`web-translate-plugin/src/providers/openai/request-builder.ts`
- 创建：`web-translate-plugin/src/providers/openai/chat-client.ts`
- 创建：`web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts`
- 创建：`web-translate-plugin/tests/unit/providers/openai/chat-client.test.ts`

**接口：**

- 产出：`buildChatRequest(input): BuiltChatRequest`。
- 产出：`OpenAiChatClient.complete(input, signal?): Promise<string>`。
- 消费：任务 1 的新版 `OpenAiSettings`、`resolveAgentProfile()`。

- [ ] **步骤 1：先写请求矩阵失败测试**

至少覆盖：

```ts
it('百炼连接测试强制关闭思考且不启用 JSON 模式', () => {
  expect(buildChatRequest({ purpose: 'connection-test', settings, messages }))
    .toMatchObject({
      model: 'translator',
      timeoutMs: 15_000,
      body: { enable_thinking: false, max_tokens: 16 },
    });
  expect(result.body).not.toHaveProperty('response_format');
});

it('百炼翻译关闭思考并启用 JSON 模式', () => {
  expect(buildChatRequest({ purpose: 'translation', settings, messages }).body)
    .toMatchObject({
      enable_thinking: false,
      response_format: { type: 'json_object' },
    });
});

it('百炼问答开启思考并传递预算', () => {
  expect(buildChatRequest({ purpose: 'agent', settings: reasoningSettings, messages }).body)
    .toMatchObject({ enable_thinking: true, thinking_budget: 4096 });
});
```

另覆盖 OpenAI effort、MiniMax disabled/adaptive、generic on 拒绝与 agent 继承模型。

- [ ] **步骤 2：运行构建器测试确认 RED**

```powershell
npm test -- tests/unit/providers/openai/request-builder.test.ts
```

预期：模块不存在。

- [ ] **步骤 3：实现纯请求构建器**

请求体基础字段：

```ts
const body: Record<string, unknown> = {
  model: profile.model,
  messages: input.messages,
};
```

purpose 固定策略：

- connection-test：translation model、15_000ms、`max_tokens: 16`、reasoning off。
- translation：translation Profile、JSON mode、reasoning off。
- agent：resolved agent Profile、按配置映射 reasoning。

只在 `dashscope` 添加 `enable_thinking/thinking_budget`，只在 `openai` 添加 `reasoning_effort`，只在 `minimax` 添加 `thinking`。

- [ ] **步骤 4：先写 Transport 超时与安全错误测试**

覆盖：

```ts
it('在 purpose 超时后中止请求', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  }));
  const pending = client.complete(input);
  await vi.advanceTimersByTimeAsync(15_000);
  await expect(pending).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
});

it('HTTP 错误不包含响应正文或凭据', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ error: { message: 'secret body' } }),
    { status: 404 },
  ));
  await expect(client.complete(input)).rejects.toMatchObject({
    code: 'LLM_HTTP_404',
  });
});
```

- [ ] **步骤 5：实现统一 Chat Transport**

`OpenAiChatClient.complete()`：

- 调用 `buildChatRequest()`。
- 请求 `${baseUrl}/chat/completions`。
- 使用内部 timeout AbortController 与用户 signal 合并。
- Abort 由用户触发时保留 AbortError；内部超时抛 `LlmProviderError('LLM_TIMEOUT')`。
- HTTP 错误只包含 `LLM_HTTP_<status>`。
- 只读取 `choices[0].message.content` 字符串。

- [ ] **步骤 6：运行 Provider 定向测试确认 GREEN**

```powershell
npm test -- tests/unit/providers/openai/request-builder.test.ts tests/unit/providers/openai/chat-client.test.ts
```

预期：请求矩阵、超时、Abort 与安全错误测试通过。

- [ ] **步骤 7：提交设置与请求基础**

```powershell
git add web-translate-plugin/src/settings web-translate-plugin/src/providers/openai/request-builder.ts web-translate-plugin/src/providers/openai/chat-client.ts web-translate-plugin/tests/unit/settings web-translate-plugin/tests/unit/providers/openai
git commit -m "feat: add llm task profiles"
```

### 任务 3：接入翻译、连接测试和论文问答

**文件：**

- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/agent/client.ts`
- 修改：`web-translate-plugin/src/settings/test-provider.ts`
- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 修改：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`
- 修改：`web-translate-plugin/tests/unit/agent/client.test.ts`
- 修改：`web-translate-plugin/tests/unit/settings/test-provider.test.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`

**接口：**

- 消费：`OpenAiChatClient.complete()`。
- 产出：翻译、连接测试和问答不再自行拼厂商请求体。
- 产出：精确消息 `{ type: 'settings:test-llm'; purpose: 'connection-test' | 'translation' | 'agent'; settings: OpenAiSettings }`；后台只接受扩展设置页发送的完整新结构。

- [ ] **步骤 1：先写三个调用方失败测试**

断言：

- 翻译客户端调用 purpose `translation` 并继续严格校验 JSON block ID。
- 快速连接测试调用 purpose `connection-test`，问题只要求返回 `OK`，不发送正式翻译块。
- 翻译配置测试调用 translation purpose，发送单个固定 ID 的 `Hello` 块并验证 JSON 契约。
- 问答配置测试调用 agent purpose，只发送短问题，不包含论文正文，但使用实际问答模型和思考参数。
- Agent 调用 purpose `agent`，并保留论文上下文与 `[p:N]` Prompt。

示例：

```ts
expect(complete).toHaveBeenCalledWith(expect.objectContaining({
  purpose: 'connection-test',
  messages: [{ role: 'user', content: 'Reply with OK.' }],
}), undefined);
```

- [ ] **步骤 2：运行调用方测试确认 RED**

```powershell
npm test -- tests/unit/providers/openai/client.test.ts tests/unit/agent/client.test.ts tests/unit/settings/test-provider.test.ts tests/unit/pdf/workspace-service.test.ts
```

预期：旧客户端仍直接 fetch 或仍读取单一 model。

- [ ] **步骤 3：最小接入统一 Transport**

- `OpenAiTranslationClient` 构造时创建或注入 `OpenAiChatClient`，调用 translation purpose 后保留现有 JSON 解析。
- `OpenAiPaperAgentClient` 调用 agent purpose。
- `testLlmConnection` 根据精确消息 purpose 分发：connection-test 直接调用 Chat Transport；translation 复用单块 TranslationClient；agent 使用短上下文调用 AgentClient。不得在测试消息中加入任意自定义请求体。
- workspace 翻译缓存键改为 `settings.openAi.translation.model`。
- workspace 创建 Agent 时传完整新版设置，问答模型由构建器解析。

- [ ] **步骤 4：修正状态与错误文案**

- 连接测试超时：`LLM 测试超时（15 秒）`。
- 翻译超时：`TRANSLATION_TIMEOUT`。
- Agent 请求进行中且 reasoning 非 off：UI 状态为“模型正在思考”。
- 用户停止仍走独立 `pdf:agent-cancel`，不取消翻译。

- [ ] **步骤 5：运行集成定向测试与类型检查**

```powershell
npm test -- tests/unit/providers/openai tests/unit/agent tests/unit/settings/test-provider.test.ts tests/unit/pdf/workspace-service.test.ts
npm run typecheck
```

预期：所有调用方测试和类型检查通过。

- [ ] **步骤 6：提交调用方接线**

```powershell
git add web-translate-plugin/src/providers/openai web-translate-plugin/src/agent web-translate-plugin/src/settings/test-provider.ts web-translate-plugin/src/pdf web-translate-plugin/tests/unit
git commit -m "refactor: route llm tasks through profiles"
```

### 任务 4：实现设置页、文档和最终验收

**文件：**

- 修改：`web-translate-plugin/entrypoints/options/App.tsx`
- 修改：`web-translate-plugin/entrypoints/options/style.css`
- 修改：`web-translate-plugin/tests/unit/settings/options-provider-actions.test.tsx`
- 修改：`web-translate-plugin/tests/e2e/webpage-translation.spec.ts`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 修改：`web-translate-plugin/README.md`

**接口：**

- 消费：新版 `OpenAiSettings`、Provider dialect 和两个 Profile。
- 产出：Provider 类型、翻译模型、问答继承、条件思考字段和两个测试按钮。

- [ ] **步骤 1：先写设置页失败测试**

SSR/纯函数测试覆盖：

```ts
expect(html).toContain('Provider 类型');
expect(html).toContain('翻译模型');
expect(html).toContain('测试翻译配置');
expect(html).toContain('继承翻译模型');
expect(html).toContain('论文问答模型');
expect(html).toContain('测试问答配置');
```

另为条件纯函数测试：

```ts
expect(reasoningControls('dashscope', 'on')).toEqual({
  showBudget: true,
  showEffort: false,
  canEnable: true,
});
expect(reasoningControls('generic-openai', 'on').canEnable).toBe(false);
```

- [ ] **步骤 2：运行 UI 测试确认 RED**

```powershell
npm test -- tests/unit/settings/options-provider-actions.test.tsx
```

预期：新字段和条件控件不存在。

- [ ] **步骤 3：实现设置页 Profile UI**

- Provider 类型 select，Endpoint 修改时仅在用户未手动覆盖时自动预选。
- Provider 基础区域提供“快速测试 LLM 连接”，使用 connection-test purpose，固定关闭思考并在 15 秒内结束。
- 翻译区域显示模型、固定“思考关闭”和 5–120 秒超时。
- 问答区域显示继承复选框；未继承时显示模型。
- 根据 dialect/mode 显示 budget、effort 或禁用原因。
- “测试翻译配置”使用 translation purpose。
- “测试问答配置”使用 agent purpose，并提示思考可能增加延迟和费用。
- 每个区域独立 activity 与 `aria-live="polite"` 状态。

- [ ] **步骤 4：更新 E2E 与 README**

- 网页 E2E 填写翻译模型并点击“测试翻译配置”。
- PDF E2E 保持设置直写时使用新 schema，并验证问答模型继承。
- README 写明 Provider 类型、双模型、思考模式、预算/强度、测试差异和流式后续边界。

- [ ] **步骤 5：运行设置定向测试**

```powershell
npm test -- tests/unit/settings tests/unit/providers/openai tests/unit/agent tests/unit/pdf/workspace-service.test.ts
```

预期：设置、请求构建与调用方测试全部通过。

- [ ] **步骤 6：运行唯一完整门禁**

```powershell
npm run check
```

预期：类型检查、全部 Vitest 和 Chrome MV3 生产构建通过。

- [ ] **步骤 7：运行网页与 PDF E2E**

```powershell
npm run test:e2e -- webpage-translation.spec.ts pdf-workspace.spec.ts
```

预期：普通网页 2 个场景与 PDF 2 个场景全部通过。

- [ ] **步骤 8：提交最终 UI 与验收**

```powershell
git add web-translate-plugin/entrypoints/options web-translate-plugin/tests web-translate-plugin/README.md
git commit -m "feat: configure llm reasoning by task"
```
