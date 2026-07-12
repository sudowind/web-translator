# LLM 默认模型与翻译诊断重构实施计划

> **供智能体执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行。所有步骤使用复选框跟踪。

**目标：** 把快速连通与翻译共用的模型提升为明确的 `defaultModel`，并让翻译测试准确区分连接故障与输出契约故障。

**架构：** 设置读取边界负责把旧 `model` 和当前 `translation.model` 迁移为 `defaultModel`；请求构造器成为三类调用选择模型的唯一边界。翻译响应解析拆为纯函数模块，只返回已校验的结果或不含响应正文的稳定错误码；设置页根据新模型呈现基础、翻译和智能体三个清晰区域。

**技术栈：** TypeScript 7、React 19、WXT 0.20、Chrome MV3、Vitest 4、Playwright 1.61。

## 全局约束

- 所有设计规格、实施计划、任务说明和验收记录使用中文。
- 不把真实 API Key、Authorization、请求头或模型响应正文写入代码、测试、日志、错误对象或聊天。
- 快速连通固定使用 `defaultModel`，关闭思考，最多输出 16 Token，超时 15 秒。
- 网页与 PDF 翻译固定使用 `defaultModel`，关闭思考，保留 JSON Object 和严格 block ID 契约。
- 智能体默认继承 `defaultModel`，关闭继承后使用独立模型。
- 旧单模型结构和当前双任务结构必须自动迁移；写入时只保存新结构。
- 仅接受直接 JSON 或单层 `json` Markdown 围栏；不得从自然语言中猜测或截取花括号内容。
- 直接在当前 `master` 工作树执行，不创建 worktree；开发阶段只跑定向测试，最终只跑一次完整门禁和相关 E2E。

---

### 任务 1：配置模型、迁移与全调用切换

**文件：**

- 修改：`web-translate-plugin/src/settings/schema.ts`
- 修改：`web-translate-plugin/src/settings/store.ts`
- 修改：`web-translate-plugin/src/settings/provider-access.ts`
- 修改：`web-translate-plugin/src/providers/openai/request-builder.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/settings/test-provider.ts`
- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 测试：`web-translate-plugin/tests/unit/settings/store.test.ts`
- 测试：`web-translate-plugin/tests/unit/settings/provider-access.test.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts`
- 测试：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`
- 测试：`web-translate-plugin/tests/unit/settings/test-provider.test.ts`
- 测试：`web-translate-plugin/tests/unit/webpage/translation-service.test.ts`

**接口：**

- 产出：`TranslationProfile`、`OpenAiSettings.defaultModel`、`OpenAiSettings.agent.inheritDefaultModel`。
- 产出：`resolveAgentProfile(settings: OpenAiSettings): ModelProfile` 在继承时把 `model` 解析为 `defaultModel`。
- 产出：三类调用与 PDF 缓存键全部使用新字段；后续任务不再读取 `translation.model` 或 `inheritTranslationModel`。

- [ ] **步骤 1：为两代旧配置迁移编写失败测试**

在 `store.test.ts` 增加两组断言：

```ts
expect(migrateOpenAiSettings({
  apiKey: 'key',
  baseUrl: 'https://api.example.test/v1',
  model: 'legacy-model',
})).toMatchObject({
  defaultModel: 'legacy-model',
  translation: { reasoning: { mode: 'off' }, timeoutMs: 30_000 },
  agent: { inheritDefaultModel: true },
});

expect(migrateOpenAiSettings({
  apiKey: 'key',
  baseUrl: 'https://api.example.test/v1',
  dialect: 'generic-openai',
  translation: {
    model: 'current-model',
    reasoning: { mode: 'off' },
    timeoutMs: 30_000,
  },
  agent: {
    inheritTranslationModel: false,
    profile: {
      model: 'agent-model',
      reasoning: { mode: 'auto' },
      timeoutMs: 120_000,
    },
  },
})).toMatchObject({
  defaultModel: 'current-model',
  agent: {
    inheritDefaultModel: false,
    profile: { model: 'agent-model' },
  },
});
```

- [ ] **步骤 2：运行迁移测试并确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/store.test.ts
```

预期：失败，原因是返回值没有 `defaultModel` 和 `inheritDefaultModel`。

- [ ] **步骤 3：重构配置类型与默认值**

在 `schema.ts` 定义：

```ts
export interface TranslationProfile {
  reasoning: ReasoningSettings & { mode: 'off' };
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

默认配置使用：

```ts
defaultModel: '',
translation: {
  reasoning: { mode: 'off' },
  timeoutMs: 30_000,
},
agent: {
  inheritDefaultModel: true,
  profile: {
    model: '',
    reasoning: { mode: 'auto', effort: 'medium' },
    timeoutMs: 120_000,
  },
},
```

并把继承解析改为：

```ts
export function resolveAgentProfile(settings: OpenAiSettings): ModelProfile {
  return settings.agent.inheritDefaultModel
    ? { ...settings.agent.profile, model: settings.defaultModel }
    : settings.agent.profile;
}
```

- [ ] **步骤 4：实现容错迁移**

`migrateOpenAiSettings` 按以下优先级选择默认模型：

```ts
const translationRecord = isRecord(record.translation) ? record.translation : {};
const defaultModel = typeof record.defaultModel === 'string'
  ? record.defaultModel
  : typeof translationRecord.model === 'string'
    ? translationRecord.model
    : typeof record.model === 'string'
      ? record.model
      : '';
```

继承字段按以下优先级迁移：

```ts
const inheritDefaultModel = typeof agentRecord.inheritDefaultModel === 'boolean'
  ? agentRecord.inheritDefaultModel
  : typeof agentRecord.inheritTranslationModel === 'boolean'
    ? agentRecord.inheritTranslationModel
    : true;
```

`translation` 只迁移 `reasoning` 和 `timeoutMs`；部分损坏字段继续回退默认值。

- [ ] **步骤 5：更新保存校验并补失败用例**

在 `provider-access.test.ts` 增加：

```ts
expect(validateProviderSettings(validSettings).openAi.defaultModel).toBe('model-name');

expect(() => validateProviderSettings({
  ...validSettings,
  openAi: { ...validSettings.openAi, defaultModel: ' ' },
})).toThrow('默认模型不能为空');
```

`validateProviderSettings` 先标准化 `defaultModel`，翻译只校验固定 `off` 和超时；智能体继承时用 `defaultModel` 填充已验证 profile。

- [ ] **步骤 6：运行任务 1 定向测试并确认 GREEN**

运行：

```powershell
npm test -- tests/unit/settings/store.test.ts tests/unit/settings/provider-access.test.ts
```

预期：两个测试文件全部通过。

#### 任务 1B：三类调用的模型选择与缓存键

**文件：**

- 修改：`web-translate-plugin/src/providers/openai/request-builder.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/settings/test-provider.ts`
- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts`
- 测试：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`
- 测试：`web-translate-plugin/tests/unit/settings/test-provider.test.ts`
- 测试：`web-translate-plugin/tests/unit/webpage/translation-service.test.ts`

**接口：**

- 消费：任务 1 的 `OpenAiSettings.defaultModel` 和 `resolveAgentProfile`。
- 产出：`buildChatRequest` 对 `connection-test` 与 `translation` 使用默认模型，对 `agent` 使用解析后的智能体模型。
- 产出：PDF 翻译缓存键的 `model` 等于实际 `defaultModel`。

- [ ] **步骤 7：编写模型选择和缓存键失败测试**

在 `request-builder.test.ts` 把 fixture 改为 `defaultModel: 'default-model'`，并增加：

```ts
expect(buildChatRequest({
  purpose: 'connection-test',
  settings,
  messages,
}).body.model).toBe('default-model');

expect(buildChatRequest({
  purpose: 'translation',
  settings,
  messages,
}).body.model).toBe('default-model');

expect(buildChatRequest({
  purpose: 'agent',
  settings: {
    ...settings,
    agent: { ...settings.agent, inheritDefaultModel: false },
  },
  messages,
}).body.model).toBe('agent-model');
```

在 `workspace-service.test.ts` 断言 `getTranslation` 接收：

```ts
expect(getTranslation).toHaveBeenCalledWith(expect.objectContaining({
  model: 'default-model',
}));
```

- [ ] **步骤 8：运行模型选择测试并确认 RED**

运行：

```powershell
npm test -- tests/unit/providers/openai/request-builder.test.ts tests/unit/pdf/workspace-service.test.ts
```

预期：旧字段引用导致类型或断言失败。

- [ ] **步骤 9：统一切换到默认模型**

请求构造器选择 profile 时使用：

```ts
function selectProfile(purpose: LlmPurpose, settings: OpenAiSettings): ModelProfile {
  if (purpose === 'agent') return resolveAgentProfile(settings);
  return {
    model: settings.defaultModel,
    reasoning: settings.translation.reasoning,
    timeoutMs: settings.translation.timeoutMs,
  };
}
```

翻译客户端配置完整性检查改为 `settings.defaultModel.trim()`；测试探针的安全 profile 使用 `defaultModel`；PDF 缓存键改为：

```ts
model: settings.openAi.defaultModel,
```

- [ ] **步骤 10：迁移所有测试 fixture 并清除旧字段引用**

运行搜索：

```powershell
rg -n "translation\.model|inheritTranslationModel|openAi\.model" web-translate-plugin/src web-translate-plugin/entrypoints web-translate-plugin/tests
```

预期：生产代码没有匹配；测试中只允许迁移兼容用例保留旧字段文本。

- [ ] **步骤 11：运行任务 1 完整定向测试并确认 GREEN**

运行：

```powershell
npm test -- tests/unit/settings/store.test.ts tests/unit/settings/provider-access.test.ts tests/unit/providers/openai/request-builder.test.ts tests/unit/pdf/workspace-service.test.ts tests/unit/settings/test-provider.test.ts tests/unit/webpage/translation-service.test.ts
```

预期：六个测试文件全部通过。

- [ ] **步骤 12：提交任务 1 的原子迁移**

```powershell
git add web-translate-plugin/src/settings/schema.ts web-translate-plugin/src/settings/store.ts web-translate-plugin/src/settings/provider-access.ts web-translate-plugin/src/providers/openai/request-builder.ts web-translate-plugin/src/providers/openai/client.ts web-translate-plugin/src/settings/test-provider.ts web-translate-plugin/src/pdf/workspace-service.ts web-translate-plugin/tests/unit/settings/store.test.ts web-translate-plugin/tests/unit/settings/provider-access.test.ts web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts web-translate-plugin/tests/unit/pdf/workspace-service.test.ts web-translate-plugin/tests/unit/settings/test-provider.test.ts web-translate-plugin/tests/unit/webpage/translation-service.test.ts
git commit -m "refactor: promote shared LLM default model"
```

---

### 任务 2：翻译响应解析与稳定错误语义

**文件：**

- 新建：`web-translate-plugin/src/providers/openai/translation-response.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/settings/test-provider.ts`
- 新建测试：`web-translate-plugin/tests/unit/providers/openai/translation-response.test.ts`
- 修改测试：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`
- 修改测试：`web-translate-plugin/tests/unit/settings/test-provider.test.ts`

**接口：**

- 产出：`TranslationProviderError`，只包含稳定 `code`。
- 产出：`parseTranslationResponse(content: string, expectedIds: readonly string[]): TranslationResult[]`。
- `OpenAiTranslationClient` 只负责请求和调用纯解析函数，不再内联 JSON/schema/ID 校验。

- [ ] **步骤 1：为直接 JSON 与单层围栏编写失败测试**

在新测试文件增加：

```ts
it.each([
  '{"translations":[{"id":"b1","text":"你好"}]}',
  '```json\n{"translations":[{"id":"b1","text":"你好"}]}\n```',
])('解析受支持的翻译内容', (content) => {
  expect(parseTranslationResponse(content, ['b1'])).toEqual([
    { id: 'b1', text: '你好' },
  ]);
});
```

- [ ] **步骤 2：为每个契约错误编写失败测试**

```ts
it.each([
  ['not json', 'TRANSLATION_JSON_INVALID'],
  ['{"answer":"你好"}', 'TRANSLATION_SCHEMA_INVALID'],
  ['{"translations":[{"id":"other","text":"你好"}]}', 'TRANSLATION_ID_UNKNOWN'],
  ['{"translations":[{"id":"b1","text":"一"},{"id":"b1","text":"二"}]}', 'TRANSLATION_ID_DUPLICATE'],
  ['{"translations":[]}', 'TRANSLATION_ID_MISSING'],
])('返回稳定错误码 %#', (content, code) => {
  let thrown: unknown;
  try {
    parseTranslationResponse(content, ['b1']);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
});
```

另加自然语言包裹 JSON 的用例，必须返回 `TRANSLATION_JSON_INVALID`，证明实现没有猜测花括号内容。

- [ ] **步骤 3：运行纯解析测试并确认 RED**

运行：

```powershell
npm test -- tests/unit/providers/openai/translation-response.test.ts
```

预期：模块不存在。

- [ ] **步骤 4：实现纯解析模块**

实现稳定错误类与严格围栏规范化：

```ts
export class TranslationProviderError extends Error {
  readonly name = 'TranslationProviderError';
  constructor(readonly code: string) {
    super(code);
  }
}

function unwrapJsonFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}
```

随后依次执行 JSON 解析、`translations` 数组元素校验、未知 ID、重复 ID 和缺失 ID 校验；每个失败点抛出规格中的对应错误码。返回值按 `expectedIds` 顺序排列。

- [ ] **步骤 5：让翻译客户端保留所有稳定错误码**

`client.ts` 从新模块导入错误类和解析函数。网络阶段继续把 `LlmProviderError` 映射为 `TRANSLATION_HTTP_*`、`TRANSLATION_TIMEOUT`、`TRANSLATION_RESPONSE_INVALID` 或 `TRANSLATION_NETWORK`；内容阶段直接调用：

```ts
return parseTranslationResponse(
  content,
  request.blocks.map(({ id }) => id),
);
```

- [ ] **步骤 6：让设置测试按阶段输出可操作提示**

在 `test-provider.ts` 增加：

```ts
const contractCodes = new Set([
  'TRANSLATION_JSON_INVALID',
  'TRANSLATION_SCHEMA_INVALID',
  'TRANSLATION_ID_UNKNOWN',
  'TRANSLATION_ID_DUPLICATE',
  'TRANSLATION_ID_MISSING',
]);

if (purpose === 'translation' && contractCodes.has(code)) {
  return new Error(
    `接口连接成功，但模型输出不符合翻译格式要求（Provider: ${dialect}；错误码: ${code}）。` +
    '请确认模型支持 JSON Object 输出，或更换适合结构化翻译的模型',
  );
}
```

补测试断言该提示不包含“检查接口地址”或“API Key”。

- [ ] **步骤 7：运行任务 2 定向测试并确认 GREEN**

运行：

```powershell
npm test -- tests/unit/providers/openai/translation-response.test.ts tests/unit/providers/openai/client.test.ts tests/unit/settings/test-provider.test.ts
```

预期：三个测试文件全部通过，所有错误对象均不包含模拟响应正文。

- [ ] **步骤 8：提交任务 2**

```powershell
git add web-translate-plugin/src/providers/openai/translation-response.ts web-translate-plugin/src/providers/openai/client.ts web-translate-plugin/src/settings/test-provider.ts web-translate-plugin/tests/unit/providers/openai/translation-response.test.ts web-translate-plugin/tests/unit/providers/openai/client.test.ts web-translate-plugin/tests/unit/settings/test-provider.test.ts
git commit -m "fix: distinguish translation contract failures"
```

---

### 任务 3：设置页信息架构与回归测试

**文件：**

- 修改：`web-translate-plugin/entrypoints/options/App.tsx`
- 修改：`web-translate-plugin/tests/unit/settings/options-provider-actions.test.tsx`
- 修改：`web-translate-plugin/tests/e2e/webpage-translation.spec.ts`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`

**接口：**

- 消费：任务 1 的 `defaultModel` 和 `inheritDefaultModel`。
- 产出：基础区域唯一的默认模型输入框；翻译区域只读模型摘要；智能体继承文案和字段与新结构一致。

- [ ] **步骤 1：编写设置页结构失败测试**

更新 `options-provider-actions.test.tsx`：

```ts
const html = renderToStaticMarkup(<App />);
expect(html).toContain('默认模型');
expect(html).toContain('默认模型用于快速连通和翻译');
expect(html).toContain('模型：使用上方默认模型');
expect(html).toContain('使用默认模型');
expect(html.match(/id="default-model"/g)).toHaveLength(1);
expect(html).not.toContain('id="translation-model"');
```

- [ ] **步骤 2：运行 UI 测试并确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/options-provider-actions.test.tsx
```

预期：旧页面仍显示“翻译模型”和“使用翻译模型”。

- [ ] **步骤 3：重排设置页并更新状态字段**

在基础区域 API Key 后加入：

```tsx
<div className="field">
  <label htmlFor="default-model">默认模型</label>
  <input
    id="default-model"
    required
    value={settings.openAi.defaultModel}
    onChange={(event) => updateDefaultModel(event.target.value)}
    aria-invalid={Boolean(fieldError.model)}
  />
  <p className="help">
    默认模型用于快速连通和翻译；论文智能体可在下方改用独立模型。
  </p>
</div>
```

翻译区域删除模型输入框，加入：

```tsx
<p className="profile-summary">模型：使用上方默认模型</p>
<p className="profile-summary">思考模式：关闭</p>
```

智能体复选框绑定 `inheritDefaultModel`，文案改为“使用默认模型”。

- [ ] **步骤 4：更新 E2E 配置 fixture 与页面定位器**

网页 E2E 使用：

```ts
await extensionPage.getByLabel('默认模型', { exact: true }).fill('test-model');
```

PDF E2E storage fixture 使用：

```ts
openAi: {
  baseUrl: `${fixtureOrigin}/openai/v1`,
  apiKey: 'e2e-openai-key',
  dialect: 'generic-openai',
  defaultModel: 'e2e-model',
  translation: {
    reasoning: { mode: 'off' },
    timeoutMs: 30_000,
  },
  agent: {
    inheritDefaultModel: true,
    profile: {
      model: 'e2e-model',
      reasoning: { mode: 'auto' },
      timeoutMs: 120_000,
    },
  },
},
```

- [ ] **步骤 5：运行任务 3 定向测试与类型检查**

运行：

```powershell
npm test -- tests/unit/settings/options-provider-actions.test.tsx tests/unit/settings/store.test.ts tests/unit/settings/provider-access.test.ts
npm run typecheck
```

预期：定向测试和类型检查全部通过。

- [ ] **步骤 6：提交任务 3**

```powershell
git add web-translate-plugin/entrypoints/options/App.tsx web-translate-plugin/tests/unit/settings/options-provider-actions.test.tsx web-translate-plugin/tests/e2e/webpage-translation.spec.ts web-translate-plugin/tests/e2e/pdf-workspace.spec.ts
git commit -m "refactor: clarify LLM default model settings"
```

---

### 任务 4：里程碑复核与最终门禁

**文件：**

- 复核：任务 1–3 的全部差异。
- 仅在发现问题时修改对应生产文件和回归测试。

**接口：**

- 消费：任务 1–3 的完整实现。
- 产出：无 Critical/Important 遗留问题的可构建 Chrome MV3 产物。

- [ ] **步骤 1：执行一次独立只读代码复核**

复核重点：迁移数据不丢失、生产代码无旧字段引用、翻译错误不泄露正文、快速/翻译/智能体模型选择正确、设置页文案与实际请求一致。

- [ ] **步骤 2：如有 Critical/Important，合并为一次修复波次**

每个问题先增加最小失败测试，再实施修复。修复波次只运行受影响的定向测试；不重复完整门禁。

- [ ] **步骤 3：运行最终完整门禁**

运行：

```powershell
npm run check
```

预期：TypeScript、全部 Vitest 和 WXT 生产构建通过。

- [ ] **步骤 4：运行网页与 PDF E2E**

运行：

```powershell
npx playwright test tests/e2e/webpage-translation.spec.ts tests/e2e/pdf-workspace.spec.ts
```

预期：网页静态/动态翻译、敏感页面保护、公开 PDF、认证 PDF、翻译与智能体路径全部通过。

- [ ] **步骤 5：执行差异卫生检查并提交必要的复核修复**

```powershell
git diff --check
git status --short
```

若复核产生代码修复：

```powershell
git add web-translate-plugin/src web-translate-plugin/entrypoints web-translate-plugin/tests
git commit -m "fix: close default model review findings"
```

最终报告必须列出最新提交、完整测试数量、E2E 数量、构建结果以及真实接口仍需用户在插件设置页人工点击验证的安全边界。
