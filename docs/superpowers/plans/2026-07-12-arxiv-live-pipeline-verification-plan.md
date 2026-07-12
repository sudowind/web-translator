# arXiv 论文在线全链路验收实施计划

> **供智能体执行：** 必须逐项使用 `superpowers:executing-plans` 执行；每个任务严格遵循测试先行，并使用复选框跟踪进度。

**目标：** 建立显式授权、凭据隔离的在线测试入口，并用 `1706.03762` 真实验证 PDF 下载、MinerU 解析、结果规范化和整篇流式翻译。

**架构：** 在线测试放在普通 Vitest 套件明确排除的 `tests/live` 中，通过独立配置和命令运行。测试直接组合生产 `loadPdfSource`、`MineruClient`、`loadMineruResult`、`OpenAiTranslationClient`、`translatePage` 与 `PageScheduler`，只把凭据加载和脱敏报告作为测试专用小模块。

**技术栈：** TypeScript、Vitest、Fetch API、PDF.js、MinerU API、OpenAI 兼容 Chat Completions SSE。

## 全局约束

- 固定样本为 `https://arxiv.org/pdf/1706.03762`。
- 使用 MinerU 公共 URL 任务，不上传 PDF 字节。
- 全部页面按生产并发数 2 翻译；失败页数必须为 0。
- 普通 `npm test` 不得执行在线测试。
- 不打印或提交 API Key、MinerU Token、请求头、论文正文、完整译文、完整 Provider 响应和带签名结果 URL。
- `.mineru-experiment.local.json` 和 `.llm-experiment.local.json` 必须被 Git 忽略。

---

### 任务 1：授权配置加载与普通测试隔离

**文件：**
- 新建：`web-translate-plugin/tests/live/live-config.ts`
- 新建：`web-translate-plugin/tests/unit/live/live-config.test.ts`
- 新建：`web-translate-plugin/.mineru-experiment.example.json`
- 修改：`.gitignore`
- 修改：`web-translate-plugin/vitest.config.ts`
- 新建：`web-translate-plugin/vitest.live.config.ts`
- 修改：`web-translate-plugin/package.json`

**接口：**
- 产生：`parseLiveConfig(mineru: unknown, llm: unknown): LivePipelineConfig`
- 产生：`loadLiveConfig(): Promise<LivePipelineConfig>`
- `LivePipelineConfig` 包含严格校验后的 `MineruSettings`、`OpenAiSettings` 和固定语言配置。

- [ ] **步骤 1：编写配置校验失败测试**

```ts
it('把本地 MinerU 与 LLM 配置转换为生产设置', () => {
  const result = parseLiveConfig(
    { baseUrl: 'https://mineru.net', token: 'private-token', modelVersion: 'vlm' },
    { baseUrl: 'https://example.test/v1', apiKey: 'private-key', model: 'model', timeoutMs: 120000 },
  );
  expect(result.mineru).toEqual({ baseUrl: 'https://mineru.net', token: 'private-token', modelVersion: 'vlm' });
  expect(result.openAi).toMatchObject({ defaultModel: 'model', dialect: 'generic-openai' });
  expect(result.openAi.translation.timeoutMs).toBe(120000);
});

it.each([
  ['MinerU Token', { baseUrl: 'https://mineru.net', token: '', modelVersion: 'vlm' }],
  ['MinerU API 根地址', { baseUrl: 'https://mineru.net/api/v4', token: 'x', modelVersion: 'vlm' }],
  ['MinerU 模型版本', { baseUrl: 'https://mineru.net', token: 'x', modelVersion: 'bad' }],
])('%s 无效时只报告字段名', (message, mineru) => {
  expect(() => parseLiveConfig(mineru, validLlm)).toThrow(message);
});
```

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：`npx vitest run tests/unit/live/live-config.test.ts`

预期：失败，提示无法解析 `tests/live/live-config`。

- [ ] **步骤 3：实现纯配置校验与文件加载**

```ts
export interface LivePipelineConfig {
  mineru: MineruSettings;
  openAi: OpenAiSettings;
  sourceLanguage: 'en';
  targetLanguage: 'zh-CN';
}

export function parseLiveConfig(mineruValue: unknown, llmValue: unknown): LivePipelineConfig {
  const mineru = readMineru(mineruValue);
  const llm = readLlm(llmValue);
  return {
    mineru,
    openAi: {
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      dialect: inferProviderDialect(llm.baseUrl),
      defaultModel: llm.model,
      translation: { reasoning: { mode: 'off' }, timeoutMs: llm.timeoutMs },
      agent: {
        inheritDefaultModel: true,
        profile: { model: llm.model, reasoning: { mode: 'auto' }, timeoutMs: 120000 },
      },
    },
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
  };
}
```

`loadLiveConfig` 使用 `readFile(new URL('../../.mineru-experiment.local.json', import.meta.url))` 和对应 LLM 文件；捕获错误时只报告缺少哪个文件，不包含文件内容。

- [ ] **步骤 4：隔离在线目录并增加显式命令**

普通 `vitest.config.ts` 的 `exclude` 增加 `tests/live/**`。新增配置：

```ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 30 * 60 * 1000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
```

`package.json` 增加：

```json
"test:live:arxiv": "vitest run --config vitest.live.config.ts"
```

- [ ] **步骤 5：创建示例配置和忽略规则**

示例文件只包含空 Token；根目录 `.gitignore` 精确增加：

```gitignore
web-translate-plugin/.mineru-experiment.local.json
```

- [ ] **步骤 6：运行定向测试和普通套件发现检查**

运行：

```powershell
npx vitest run tests/unit/live/live-config.test.ts
npx vitest list
```

预期：配置测试通过；列表中不存在 `tests/live/arxiv-pipeline.test.ts`。

- [ ] **步骤 7：提交配置与隔离层**

```powershell
git add .gitignore web-translate-plugin/.mineru-experiment.example.json web-translate-plugin/package.json web-translate-plugin/vitest.config.ts web-translate-plugin/vitest.live.config.ts web-translate-plugin/tests/live/live-config.ts web-translate-plugin/tests/unit/live/live-config.test.ts
git commit -m "test: isolate authorized live provider checks"
```

---

### 任务 2：生产模块全链路在线测试

**文件：**
- 新建：`web-translate-plugin/tests/live/live-report.ts`
- 新建：`web-translate-plugin/tests/unit/live/live-report.test.ts`
- 新建：`web-translate-plugin/tests/live/arxiv-pipeline.test.ts`

**接口：**
- 消费：任务 1 的 `loadLiveConfig()`。
- 产生：`safeErrorCode(error: unknown): string`，只返回稳定错误码或 `UNKNOWN_ERROR`。
- 产生：显式授权的 `arXiv 1706.03762 在线全链路` Vitest 用例。

- [ ] **步骤 1：编写报告脱敏失败测试**

```ts
it('错误报告只保留稳定错误码', () => {
  expect(safeErrorCode({ code: 'MINERU_TIMEOUT', token: 'private' })).toBe('MINERU_TIMEOUT');
  expect(safeErrorCode(new Error('private raw body'))).toBe('UNKNOWN_ERROR');
});
```

运行：`npx vitest run tests/unit/live/live-report.test.ts`

预期：失败，提示 `safeErrorCode` 尚不存在。

- [ ] **步骤 2：实现报告脱敏函数并通过测试**

```ts
export function safeErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === 'string' && /^(PDF|MINERU|TRANSLATION|LLM)_[A-Z0-9_]+$/.test(code)
    ? code
    : 'UNKNOWN_ERROR';
}
```

运行：`npx vitest run tests/unit/live/live-report.test.ts`

预期：通过。

- [ ] **步骤 3：编写在线测试骨架并确认缺少本地 MinerU 配置时安全失败**

测试固定定义：

```ts
const SOURCE_URL = 'https://arxiv.org/pdf/1706.03762';
const EXPECTED_PAGE_COUNT = 15;
const TOTAL_TIMEOUT_MS = 25 * 60 * 1000;
```

首先调用 `loadLiveConfig()`，随后用 `AbortController` 设置总流程上限。运行 `npm run test:live:arxiv`，预期只提示缺少 `.mineru-experiment.local.json`，不显示 LLM Key。

- [ ] **步骤 4：实现真实 PDF 与 MinerU 阶段**

```ts
const source = await loadPdfSource(SOURCE_URL, fetch, controller.signal);
const pdf = await getDocument({ data: Uint8Array.from(source.bytes) }).promise;
expect(pdf.numPages).toBe(EXPECTED_PAGE_COUNT);

const mineru = new MineruClient(config.mineru);
const task = await mineru.createUrlTask(SOURCE_URL, controller.signal);
const result = await mineru.waitForResult(task, controller.signal);
if (result.state !== 'done') throw Object.assign(new Error('MINERU_TASK_FAILED'), { code: 'MINERU_TASK_FAILED' });
const document = await loadMineruResult(result.fullZipUrl, {
  sourceUrl: source.url,
  hash: source.hash,
  title: source.title,
  pageCount: pdf.numPages,
});
```

断言文档页数等于 PDF 页数，所有块总数大于 0，并在 `finally` 中销毁 PDF 文档与清理总超时。

- [ ] **步骤 5：实现并发数 2 的整篇逐页翻译**

创建 `PageScheduler(document.pageCount, 2)` 和两个 worker。每个 worker 调用 `take()`，对页面执行：

```ts
const translations = await translatePage(
  translationClient,
  document.pages[pageNumber - 1],
  { sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage },
  controller.signal,
  undefined,
  config.openAi.defaultModel,
);
```

成功时 `markDone(pageNumber)` 并记录页码、块数、耗时；失败时 `markFailed(pageNumber)`，只记录 `safeErrorCode(error)`。所有 worker 结束后断言完成页数等于文档页数、失败数组为空。

- [ ] **步骤 6：验证在线测试可被独立发现但不执行真实请求**

运行：`npx vitest list --config vitest.live.config.ts`

预期：只列出 `tests/live/arxiv-pipeline.test.ts` 的一个在线用例。

- [ ] **步骤 7：提交全链路测试**

```powershell
git add web-translate-plugin/tests/live/live-report.ts web-translate-plugin/tests/unit/live/live-report.test.ts web-translate-plugin/tests/live/arxiv-pipeline.test.ts
git commit -m "test: cover live arxiv translation pipeline"
```

---

### 任务 3：配置真实 MinerU Token 并执行验收

**文件：**
- 本地忽略：`web-translate-plugin/.mineru-experiment.local.json`
- 不新增跟踪文件；真实结果只在当前任务输出中汇报。

**接口：**
- 消费：任务 2 的 `npm run test:live:arxiv`。
- 产生：不含敏感数据的真实验收结果。

- [ ] **步骤 1：创建本地凭据文件并确认忽略状态**

从示例复制出本地文件，预填 `baseUrl` 和 `modelVersion`，Token 留空供用户填写。运行：

```powershell
git check-ignore -v web-translate-plugin/.mineru-experiment.local.json
git status --ignored --short web-translate-plugin/.mineru-experiment.local.json
```

预期：文件显示为 `!!`。

- [ ] **步骤 2：用户填写 Token 后运行配置预检**

测试只读取并验证非空，不输出 Token。配置错误时停止，不创建 MinerU 任务。

- [ ] **步骤 3：执行真实全链路验收**

运行：`npm run test:live:arxiv`

预期：PDF 页数为 15；MinerU 文档块数大于 0；15 页翻译全部完成；失败页数为 0。

- [ ] **步骤 4：运行普通质量门禁**

运行：`npm run check`

预期：类型检查、普通 Vitest 套件和 WXT 构建通过，且不会再次执行在线验收。

- [ ] **步骤 5：核对仓库状态和密钥隔离**

运行：`git status --short` 与 `git status --ignored --short web-translate-plugin/.mineru-experiment.local.json web-translate-plugin/.llm-experiment.local.json`。

预期：跟踪工作树干净；两个本地凭据文件均显示为 `!!`。
