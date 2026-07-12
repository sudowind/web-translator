# LLM 流式翻译与空闲超时实施计划

> **供智能体执行：** 必须逐项使用 `superpowers:executing-plans` 执行；每个任务严格遵循测试先行，并使用复选框跟踪进度。

**目标：** 将翻译请求改为 SSE 流式接收，并把翻译超时从固定总时限改为空闲超时，同时保持完整 JSON 校验后才提交结果。

**架构：** 新建独立 SSE 读取模块，负责协议分帧、内容累积和活动通知；`OpenAiChatClient` 仍负责 HTTP、取消与错误映射，根据翻译请求的 `stream` 标志选择 SSE 或普通 JSON 读取。空闲计时器由客户端持有，收到响应头和每个有效 SSE 事件时重置。

**技术栈：** TypeScript、Fetch API、ReadableStream、Vitest、WXT。

## 全局约束

- 翻译请求继续发送 `response_format: { type: "json_object" }`。
- 只有翻译用途自动发送 `stream: true`；连接测试和智能体保持非流式。
- 翻译配置中的 `timeoutMs` 表示连续没有响应活动的最长时间。
- 页面仅接收并缓存完整且通过现有 Schema 与块 ID 校验的翻译。
- 不改变页面翻译顺序、并发数、重试次数和 UI。
- 不记录 API Key、完整请求正文、模型输出或包含隐私内容的流片段。

---

### 任务 1：实现独立 SSE 响应解析器

**文件：**
- 新建：`web-translate-plugin/src/providers/openai/sse.ts`
- 新建：`web-translate-plugin/tests/unit/providers/openai/sse.test.ts`

**接口：**
- 输入：`readChatCompletionSse(response: Response, onActivity: () => void): Promise<string>`
- 输出：累积后的 `choices[0].delta.content` 完整字符串。
- 错误：缺少响应体、无效 JSON 事件、无效事件结构或没有任何文本时抛出 `SseResponseError`。

- [ ] **步骤 1：编写跨 chunk、活动通知和结束标记的失败测试**

```ts
it('跨 chunk 解析 SSE 并在每个有效事件上报告活动', async () => {
  const response = streamResponse([
    'data: {"choices":[{"delta":{"content":"{\\"translations\\":"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"[]}"}}]}\n\ndata: [DONE]\n\n',
  ]);
  const onActivity = vi.fn();

  await expect(readChatCompletionSse(response, onActivity)).resolves.toBe('{"translations":[]}');
  expect(onActivity).toHaveBeenCalledTimes(2);
});
```

- [ ] **步骤 2：运行定向测试并确认因模块不存在而失败**

运行：`npx vitest run tests/unit/providers/openai/sse.test.ts`

预期：失败，提示无法解析 `src/providers/openai/sse`。

- [ ] **步骤 3：实现最小 SSE 读取器**

```ts
export class SseResponseError extends Error {}

export async function readChatCompletionSse(
  response: Response,
  onActivity: () => void,
): Promise<string> {
  if (!response.body) throw new SseResponseError('SSE_BODY_MISSING');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let event: unknown;
      try { event = JSON.parse(data); } catch { throw new SseResponseError('SSE_EVENT_INVALID'); }
      const delta = readDelta(event);
      onActivity();
      if (delta !== undefined) content += delta;
    }
  }
  if (!content) throw new SseResponseError('SSE_CONTENT_MISSING');
  return content;
}
```

实现私有 `readDelta`，仅接受带有 `choices[0].delta` 对象的事件；`content` 缺失时允许返回 `undefined`，结构不合法时抛出 `SSE_EVENT_INVALID`。

- [ ] **步骤 4：补充并通过边界测试**

```ts
it.each([
  ['缺少响应体', new Response(null), 'SSE_BODY_MISSING'],
  ['无效事件 JSON', streamResponse(['data: nope\n\n']), 'SSE_EVENT_INVALID'],
  ['没有文本', streamResponse(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n']), 'SSE_CONTENT_MISSING'],
])('%s 时返回稳定错误', async (_name, response, code) => {
  await expect(readChatCompletionSse(response, vi.fn())).rejects.toThrow(code);
});
```

运行：`npx vitest run tests/unit/providers/openai/sse.test.ts`

预期：全部通过。

- [ ] **步骤 5：提交 SSE 解析器**

```powershell
git add web-translate-plugin/src/providers/openai/sse.ts web-translate-plugin/tests/unit/providers/openai/sse.test.ts
git commit -m "feat: parse streaming chat responses"
```

---

### 任务 2：接入翻译流式请求和空闲超时

**文件：**
- 修改：`web-translate-plugin/src/providers/openai/request-builder.ts`
- 修改：`web-translate-plugin/src/providers/openai/chat-client.ts`
- 修改：`web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts`
- 修改：`web-translate-plugin/tests/unit/providers/openai/chat-client.test.ts`

**接口：**
- 消费：任务 1 的 `readChatCompletionSse(response, onActivity)` 与 `SseResponseError`。
- 保持：`OpenAiChatClient.complete(input, signal?): Promise<string>` 对调用者的公开签名不变。
- 产生：翻译请求体包含 `stream: true`；翻译用途采用响应活动驱动的空闲计时器。

- [ ] **步骤 1：编写请求契约失败测试**

```ts
expect(buildChatRequest({ purpose: 'translation', settings, messages }).body).toMatchObject({
  response_format: { type: 'json_object' },
  stream: true,
});
expect(buildChatRequest({ purpose: 'connection-test', settings, messages }).body).not.toHaveProperty('stream');
expect(buildChatRequest({ purpose: 'agent', settings, messages }).body).not.toHaveProperty('stream');
```

运行：`npx vitest run tests/unit/providers/openai/request-builder.test.ts`

预期：翻译断言失败，因为当前请求体没有 `stream`。

- [ ] **步骤 2：最小修改请求构建器并通过定向测试**

```ts
if (purpose === 'translation') {
  body.response_format = { type: 'json_object' };
  body.stream = true;
}
```

运行：`npx vitest run tests/unit/providers/openai/request-builder.test.ts`

预期：全部通过。

- [ ] **步骤 3：编写持续活动超过总时长仍成功的失败测试**

使用可控 `ReadableStream` 每 20 秒发送一个有效 SSE 事件，将翻译 `timeoutMs` 设为 30 秒，总生成时长推进到 40 秒以上；断言请求没有在第 30 秒失败，并在 `[DONE]` 后返回完整 JSON。

```ts
const completion = client.complete({ purpose: 'translation', messages: [] });
await vi.advanceTimersByTimeAsync(20_000);
push('data: {"choices":[{"delta":{"content":"{\\"translations\\":"}}]}\n\n');
await vi.advanceTimersByTimeAsync(20_000);
push('data: {"choices":[{"delta":{"content":"[]}"}}]}\n\ndata: [DONE]\n\n');
close();
await expect(completion).resolves.toBe('{"translations":[]}');
```

运行：`npx vitest run tests/unit/providers/openai/chat-client.test.ts`

预期：失败，当前客户端尝试按普通 JSON 读取流式响应，或在固定 30 秒总时限中止。

- [ ] **步骤 4：编写连续空闲与调用方取消的失败测试**

```ts
const timedOut = expect(
  client.complete({ purpose: 'translation', messages: [] }),
).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
await vi.advanceTimersByTimeAsync(30_000);
await timedOut;
```

保留现有调用方取消断言，确保取消仍产生 `AbortError` 而不是 `LLM_TIMEOUT`。

- [ ] **步骤 5：实现活动驱动的空闲计时器和流式分支**

在 `complete` 中仅对翻译流式请求使用可重置计时器：

```ts
let timeout: ReturnType<typeof setTimeout>;
const armTimeout = () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
};
armTimeout();

const response = await fetcher(url, init);
if (!response.ok) throw new LlmProviderError(`LLM_HTTP_${response.status}`);
if (body.stream === true) {
  armTimeout();
  return await readChatCompletionSse(response, armTimeout);
}
return await readJsonContent(response);
```

捕获 `SseResponseError` 时映射为 `LLM_RESPONSE_INVALID`；`finally` 中清理计时器与调用方取消监听器。非流式路径仍保留当前固定总超时语义。

- [ ] **步骤 6：运行 Provider 定向测试并修复类型问题**

运行：`npx vitest run tests/unit/providers/openai/request-builder.test.ts tests/unit/providers/openai/sse.test.ts tests/unit/providers/openai/chat-client.test.ts tests/unit/providers/openai/client.test.ts`

预期：全部通过，无未处理 Promise 或计时器警告。

- [ ] **步骤 7：提交流式客户端集成**

```powershell
git add web-translate-plugin/src/providers/openai/request-builder.ts web-translate-plugin/src/providers/openai/chat-client.ts web-translate-plugin/tests/unit/providers/openai/request-builder.test.ts web-translate-plugin/tests/unit/providers/openai/chat-client.test.ts
git commit -m "fix: use idle timeout for streaming translation"
```

---

### 任务 3：回归验证、实验工具归档与最终门禁

**文件：**
- 修改：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`（仅当现有 mock 需要改为 SSE）
- 保留：`web-translate-plugin/scripts/llm-timeout-experiment.mjs`
- 保留：`web-translate-plugin/.llm-experiment.example.json`
- 修改：`.gitignore`

**接口：**
- 消费：任务 2 完成后的翻译流式请求契约。
- 产生：可重复但不进入生产构建的脱敏实验工具，以及完整验证证据。

- [ ] **步骤 1：让翻译客户端集成测试返回真实 SSE**

将翻译用途的 mock 响应改为：

```ts
new Response(
  'data: {"choices":[{"delta":{"content":"{\\"translations\\":[{\\"id\\":\\"a\\",\\"text\\":\\"你好\\"}]}"}}]}\n\n' +
  'data: [DONE]\n\n',
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)
```

断言最终 `TranslationResult[]` 与原测试一致，证明页面上层无需感知流式协议。

- [ ] **步骤 2：运行翻译与失败诊断定向回归**

运行：`npx vitest run tests/unit/providers/openai tests/unit/translation tests/unit/pdf/workspace-service.test.ts`

预期：全部通过；超时仍映射为 `TRANSLATION_TIMEOUT`，现有失败详情保持可用。

- [ ] **步骤 3：检查实验工具与密钥隔离**

运行：

```powershell
git check-ignore -v web-translate-plugin/.llm-experiment.local.json
git grep -n "sk-ws" -- . ':!web-translate-plugin/.llm-experiment.local.json'
node --check web-translate-plugin/scripts/llm-timeout-experiment.mjs
```

预期：本地配置命中 `.gitignore`；仓库跟踪内容没有 Key 前缀；实验脚本语法有效。

- [ ] **步骤 4：运行最终质量门禁**

在 `web-translate-plugin` 中运行：`npm run check`

预期：TypeScript 类型检查、全部 Vitest 测试和 WXT 构建均通过。

- [ ] **步骤 5：提交实验工具和必要回归调整**

```powershell
git add .gitignore web-translate-plugin/.llm-experiment.example.json web-translate-plugin/scripts/llm-timeout-experiment.mjs web-translate-plugin/tests/unit/providers/openai/client.test.ts
git commit -m "test: add LLM streaming timeout experiment"
```

- [ ] **步骤 6：核对最终差异与提交记录**

运行：`git status --short` 和 `git log -4 --oneline`

预期：工作树干净；设计、计划、SSE 解析、流式空闲超时和实验工具均有对应提交。
