# PDF 表格与图片标题翻译及占位渲染实施计划

> **面向执行智能体：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划；使用复选框跟踪每个步骤，并严格遵循测试驱动开发的红—绿—重构循环。

**目标：** 表格和图片本体不进入 LLM、不在译文区渲染，只翻译 MinerU caption，并修复不完整旧缓存导致媒体区块永久显示“翻译中”的问题。

**架构：** 在 MinerU 规范化边界为媒体区块增加独立 `caption` 字段；逐页翻译通过唯一共享函数生成请求区块，工作台服务使用同一函数校验缓存 ID 完整性。含媒体页面切换到翻译缓存 schema `2`，右侧表格和图片统一由媒体占位组件渲染标题状态。

**技术栈：** TypeScript 7、React 19、WXT、MinerU `content_list.json`、Vitest、Playwright、Chrome MV3。

## 全局约束

- 所有规格、计划、测试名称和用户可见文案使用中文；代码标识符和 Provider 字段保留英文。
- 表格 HTML、图片路径、图片 OCR 正文不得发送给 LLM。
- 媒体标题只读取 MinerU `table_caption` 与 `image_caption`，不得从其他字段猜测。
- 无 caption 的表格和图片不得调用 LLM，右侧稳定显示“无标题”。
- 保持区块 ID、页内顺序、坐标、高亮、固定状态、PDF 文本框选和智能体侧栏行为不变。
- 仅含媒体区块的页面使用翻译缓存 schema `2`；纯文本页面继续使用 schema `1`。
- 不读取、打印或提交 `.llm-experiment.local.json`、`.mineru-experiment.local.json` 中的凭证。
- 开发阶段运行定向测试；全部任务完成后运行一次无更新 E2E 和一次完整 `npm run check`。

## 文件结构

- `web-translate-plugin/src/document/model.ts`：声明文档 schema `3` 和媒体 `caption` 字段。
- `web-translate-plugin/src/document/normalize-mineru.ts`：只从 MinerU caption 数组生成媒体标题。
- `web-translate-plugin/src/translation/translate-page.ts`：唯一生成逐页翻译请求区块的边界。
- `web-translate-plugin/src/providers/openai/client.ts`：明确媒体输入仅为 caption 的提示词。
- `web-translate-plugin/src/pdf/workspace-service.ts`：按当前页期望 ID 精确校验缓存并选择缓存 schema。
- `web-translate-plugin/src/pdf/TranslationPane.tsx`：渲染表格/图片占位卡片及明确状态。
- `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`：媒体占位卡片的可访问视觉样式。
- 对应 Vitest 与 Playwright 文件：锁定规范化、请求边界、缓存、组件和完整浏览器流程。

---

### 任务 1：建立媒体 caption 文档模型

**文件：**

- 修改：`web-translate-plugin/src/document/model.ts`
- 修改：`web-translate-plugin/src/document/normalize-mineru.ts`
- 测试：`web-translate-plugin/tests/unit/document/normalize-mineru.test.ts`
- 修改测试夹具：`web-translate-plugin/tests/unit/agent/context-builder.test.ts`
- 修改测试夹具：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 修改测试夹具：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`
- 修改测试夹具：`web-translate-plugin/tests/unit/storage/repositories.test.ts`

**接口：**

- 产出：`DOCUMENT_SCHEMA_VERSION = 3`。
- 产出：`DocumentBlock.caption?: string`。
- 保持：`DocumentBlock.text`、`html`、`resourceUrl`、`polygon` 与 ID 生成规则不变。

- [ ] **步骤 1：写入 caption 规范化失败测试**

在 `normalize-mineru.test.ts` 增加：

```ts
it('把 MinerU 表格与图片标题写入独立 caption 并忽略全空白标题', () => {
  const model = normalizeMineru([
    {
      page_idx: 0,
      type: 'table',
      text: 'table OCR must stay separate',
      table_body: '<table><tr><td>secret cell</td></tr></table>',
      table_caption: [' Table one ', 'continued'],
    },
    {
      page_idx: 0,
      type: 'image',
      text: 'image OCR must stay separate',
      img_path: 'images/figure.png',
      image_caption: [' Figure one '],
    },
    { page_idx: 0, type: 'table', table_caption: [' ', '\t'] },
    { page_idx: 0, type: 'image', img_path: 'images/no-title.png' },
  ], { ...metadata, pageCount: 1 });

  expect(model.schemaVersion).toBe(3);
  expect(model.pages[0].blocks).toMatchObject([
    { kind: 'table', text: 'table OCR must stay separate', caption: 'Table one\ncontinued' },
    { kind: 'figure', text: 'image OCR must stay separate', caption: 'Figure one' },
    { kind: 'table', text: '' },
    { kind: 'figure', text: '' },
  ]);
  expect(model.pages[0].blocks[2]).not.toHaveProperty('caption');
  expect(model.pages[0].blocks[3]).not.toHaveProperty('caption');
});
```

把现有 schema 断言改为 `DOCUMENT_SCHEMA_VERSION`，并继续保留非法 caption 数组的安全错误测试。

- [ ] **步骤 2：运行规范化测试并确认红灯原因**

运行：

```powershell
npx vitest run tests/unit/document/normalize-mineru.test.ts
```

预期：失败信息显示 schema 仍为 `2` 且媒体区块没有 `caption`；不得因测试语法或 metadata 无效而失败。

- [ ] **步骤 3：实现最小文档模型与 caption 归一化**

在 `model.ts` 修改：

```ts
export const DOCUMENT_SCHEMA_VERSION = 3;

export interface DocumentBlock {
  id: string;
  pageId: string;
  order: number;
  kind: BlockKind;
  text: string;
  caption?: string;
  headingLevel?: number;
  latex?: string;
  html?: string;
  resourceUrl?: string;
  polygon?: number[];
}
```

在 `normalize-mineru.ts` 增加：

```ts
function normalizeCaption(value: string[] | undefined): string | undefined {
  const caption = value
    ?.map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
  return caption || undefined;
}
```

在区块循环中使用独立字段：

```ts
const caption = normalizeCaption(imageCaption ?? tableCaption);
const normalizedText = text ?? caption ?? '';

page.blocks.push({
  id: blockId(normalizedMetadata.hash, pageIndex as number, order),
  pageId: page.id,
  order,
  kind,
  text: normalizedText,
  ...(caption === undefined ? {} : { caption }),
  // 其余既有可选字段保持原样
});
```

所有显式 `DocumentModel` 测试夹具继续引用 `DOCUMENT_SCHEMA_VERSION`，不硬编码旧版本。

- [ ] **步骤 4：运行受影响测试与类型检查并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/document/normalize-mineru.test.ts tests/unit/agent/context-builder.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/workspace-service.test.ts tests/unit/storage/repositories.test.ts
npm run typecheck
```

预期：五个测试文件全部通过，TypeScript 不报告缺失字段或 schema 错误。

- [ ] **步骤 5：提交文档模型里程碑**

```powershell
git add web-translate-plugin/src/document/model.ts web-translate-plugin/src/document/normalize-mineru.ts web-translate-plugin/tests/unit/document/normalize-mineru.test.ts web-translate-plugin/tests/unit/agent/context-builder.test.ts web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx web-translate-plugin/tests/unit/pdf/workspace-service.test.ts web-translate-plugin/tests/unit/storage/repositories.test.ts
git commit -m "fix: preserve MinerU media captions"
```

---

### 任务 2：统一翻译请求边界并修复缓存完整性

**文件：**

- 修改：`web-translate-plugin/src/translation/translate-page.ts`
- 修改：`web-translate-plugin/src/providers/openai/client.ts`
- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 测试：`web-translate-plugin/tests/unit/translation/translate-page.test.ts`
- 测试：`web-translate-plugin/tests/unit/providers/openai/client.test.ts`
- 测试：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`

**接口：**

- 产出：`translationBlocksForPage(page: DocumentPage): TranslationRequest['blocks']`。
- 产出：`translationCacheSchemaForPage(page: DocumentPage): 1 | 2`，保持在工作台服务内部。
- 产出：缓存只有与 `translationBlocksForPage` 的 ID 集合精确一致时才命中。

- [ ] **步骤 1：写入媒体请求边界失败测试**

把 `translate-page.test.ts` 页面夹具扩展为有标题和无标题媒体，并断言：

```ts
const page = {
  id: 'h:p1',
  index: 0,
  blocks: [
    { id: 'b1', pageId: 'h:p1', order: 0, kind: 'paragraph' as const, text: 'Hello' },
    {
      id: 't1', pageId: 'h:p1', order: 1, kind: 'table' as const,
      text: 'table OCR', caption: 'Table title', html: '<table><tr><td>secret</td></tr></table>',
    },
    {
      id: 'f1', pageId: 'h:p1', order: 2, kind: 'figure' as const,
      text: 'image OCR', caption: 'Figure title', resourceUrl: 'images/secret.png',
    },
    { id: 't2', pageId: 'h:p1', order: 3, kind: 'table' as const, text: 'no title', html: '<table></table>' },
    { id: 'f2', pageId: 'h:p1', order: 4, kind: 'figure' as const, text: 'no title', resourceUrl: 'images/no-title.png' },
  ],
};

expect(translate).toHaveBeenCalledWith({
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  blocks: [
    { id: 'b1', kind: 'paragraph', text: 'Hello' },
    { id: 't1', kind: 'table', text: 'Table title' },
    { id: 'f1', kind: 'figure', text: 'Figure title' },
  ],
}, undefined);
```

同时断言序列化请求不包含 `secret`、`table OCR`、`image OCR`、图片路径和无标题媒体 ID。

- [ ] **步骤 2：写入不完整缓存失败测试**

在 `workspace-service.test.ts` 创建含正文、表格 caption 和图片 caption 的 `mediaModel`，增加：

```ts
it('缺少媒体标题 ID 的旧缓存会重新翻译并覆盖媒体页面缓存', async () => {
  const cached = [{ id: 'b1', text: '正文译文' }];
  const fresh = [
    { id: 'b1', text: '正文译文' },
    { id: 't1', text: '表格标题' },
    { id: 'f1', text: '图片标题' },
  ];
  const translate = vi.fn().mockResolvedValue(fresh);
  const putTranslation = vi.fn();
  const getTranslation = vi.fn().mockResolvedValue({ blocks: cached });
  const service = makeService(undefined, {
    getDocument: vi.fn().mockResolvedValue(mediaModel),
    getTranslation,
    putTranslation,
    createOpenAi: vi.fn().mockReturnValue({ translate }),
  });

  await expect(service.handle(
    { type: 'pdf:translate-page', hash: source.hash, page: 1 },
    7,
  )).resolves.toEqual(fresh);
  expect(getTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 2 }));
  expect(translate).toHaveBeenCalledOnce();
  expect(putTranslation).toHaveBeenCalledWith(expect.objectContaining({ schema: 2 }), fresh);
});
```

再增加两项：完整媒体缓存不创建 LLM 客户端；纯文本页仍查询 schema `1`。缓存包含重复或额外 ID 时必须视为失效。

- [ ] **步骤 3：运行定向测试并确认红灯原因**

运行：

```powershell
npx vitest run tests/unit/translation/translate-page.test.ts tests/unit/pdf/workspace-service.test.ts tests/unit/providers/openai/client.test.ts
```

预期：当前实现仍发送表格 HTML、不发送图片 caption，并错误复用不完整缓存；失败不得来自 mock 配置或类型错误。

- [ ] **步骤 4：实现共享翻译区块生成函数**

在 `translate-page.ts` 导出并使用：

```ts
export function translationBlocksForPage(
  page: DocumentPage,
): TranslationRequest['blocks'] {
  return page.blocks.flatMap((block) => {
    if (block.kind === 'table' || block.kind === 'figure') {
      const caption = block.caption?.trim();
      return caption ? [{ id: block.id, kind: block.kind, text: caption }] : [];
    }
    if (!translatableKinds.has(block.kind)) return [];
    return [{ id: block.id, kind: block.kind, text: block.text }];
  });
}
```

从 `translatableKinds` 移除 `table`，并让 `translatePage` 使用：

```ts
const blocks = translationBlocksForPage(page);
```

更新 OpenAI 系统提示词中的表格规则：

```ts
'For table and figure blocks, the input text is caption only. Translate it as plain Markdown; never output a table body or image content.'
```

- [ ] **步骤 5：实现精确缓存校验和媒体页面 schema**

在 `workspace-service.ts` 导入共享函数，并增加：

```ts
function translationCacheSchemaForPage(page: DocumentPage): 1 | 2 {
  return page.blocks.some((block) => block.kind === 'table' || block.kind === 'figure') ? 2 : 1;
}

function isTranslationsForIds(
  value: unknown,
  expectedIds: readonly string[],
): value is TranslationResult[] {
  if (!Array.isArray(value)) return false;
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== 'object' || item === null ||
      typeof (item as TranslationResult).id !== 'string' ||
      typeof (item as TranslationResult).text !== 'string' ||
      !expected.has((item as TranslationResult).id) ||
      seen.has((item as TranslationResult).id)
    ) return false;
    seen.add((item as TranslationResult).id);
  }
  return seen.size === expected.size;
}
```

在 `translate` 中只计算一次期望区块：

```ts
const expectedIds = translationBlocksForPage(page).map((block) => block.id);
const key: TranslationKey = {
  // 既有维度保持不变
  schema: translationCacheSchemaForPage(page),
};
const cached = await this.dependencies.getTranslation(key);
if (cached && isTranslationsForIds(cached.blocks, expectedIds)) return cached.blocks;
```

删除旧的宽松 `isTranslations`，不清空整篇缓存。

- [ ] **步骤 6：运行请求、缓存、Provider 与类型测试并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/translation/translate-page.test.ts tests/unit/pdf/workspace-service.test.ts tests/unit/providers/openai/client.test.ts tests/unit/storage/repositories.test.ts
npm run typecheck
```

预期：媒体请求只含 caption；完整缓存命中；不完整、重复和额外 ID 缓存重新翻译；schema 选择正确；TypeScript 通过。

- [ ] **步骤 7：提交翻译与缓存里程碑**

```powershell
git add web-translate-plugin/src/translation/translate-page.ts web-translate-plugin/src/providers/openai/client.ts web-translate-plugin/src/pdf/workspace-service.ts web-translate-plugin/tests/unit/translation/translate-page.test.ts web-translate-plugin/tests/unit/providers/openai/client.test.ts web-translate-plugin/tests/unit/pdf/workspace-service.test.ts
git commit -m "fix: translate only media captions"
```

---

### 任务 3：渲染媒体占位卡片和明确状态

**文件：**

- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 测试：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 测试：`web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`

**接口：**

- 产出：表格和图片使用 `.translation-media-placeholder`。
- 产出：占位卡片使用 `data-media-kind="table" | "figure"`。
- 保持：外层 `.translation-block` 的 ID、交互事件和高亮逻辑不变。

- [ ] **步骤 1：写入占位卡片和状态失败测试**

在 `workspace-components.test.tsx` 的页面夹具增加：

```ts
{
  id: 't1', pageId: 'p1', order: 7, kind: 'table', text: 'table OCR',
  caption: 'Table title', html: '<table><tr><td>secret</td></tr></table>',
},
{
  id: 'f1', pageId: 'p1', order: 8, kind: 'figure', text: 'image OCR',
  caption: 'Figure title', resourceUrl: 'images/secret.png',
},
{ id: 't2', pageId: 'p1', order: 9, kind: 'table', text: '', html: '<table></table>' },
```

完成状态只给 `t1` 提供译文，断言：

```ts
expect(html).toContain('class="translation-media-placeholder"');
expect(html).toContain('data-media-kind="table"');
expect(html).toContain('data-media-kind="figure"');
expect(html).toContain('表格标题');
expect(html).toContain('标题译文缺失');
expect(html).toContain('无标题');
expect(html).not.toContain('<table>');
expect(html).not.toContain('<img');
expect(html).not.toContain('secret');
expect(html).not.toContain('翻译中');
```

另写 translating 和 failed 状态用例，分别断言“标题翻译中…”和“标题翻译失败”。

在 `pdf-styles.test.ts` 断言 `.translation-media-placeholder`、标签、状态和 `prefers-reduced-motion` 规则存在。

- [ ] **步骤 2：运行组件测试并确认红灯原因**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/pdf-styles.test.ts
```

预期：当前表格仍渲染 Markdown table，图片仍显示源文本，且没有媒体占位样式。

- [ ] **步骤 3：实现媒体占位组件**

在 `TranslationPane.tsx` 增加：

```tsx
function MediaPlaceholder({
  block,
  translation,
  status,
}: {
  block: DocumentBlock;
  translation?: string;
  status: TranslationPageStatus;
}) {
  const label = block.kind === 'table' ? '表格' : '图片';
  const hasCaption = Boolean(block.caption?.trim());
  const stateText = !hasCaption
    ? '无标题'
    : translation
      ? undefined
      : status === 'failed'
        ? '标题翻译失败'
        : status === 'done'
          ? '标题译文缺失'
          : '标题翻译中…';
  return (
    <div className="translation-media-placeholder" data-media-kind={block.kind}>
      <span className="translation-media-label">{label}</span>
      <div className="translation-media-caption">
        {translation
          ? <MarkdownContent content={translation} inline />
          : <span data-media-state>{stateText}</span>}
      </div>
    </div>
  );
}
```

让 `TranslationBlock` 接收 `status`。表格或图片在通用 `content` 计算前直接返回 `MediaPlaceholder`；删除现有表格 Markdown 分支，禁止读取 `html`、`resourceUrl` 或媒体 `text` 作为右侧内容。

- [ ] **步骤 4：增加媒体占位样式**

在 `style.css` 增加：

```css
.translation-media-placeholder { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; min-height: 72px; padding: 14px; border: 1px dashed #94a3b8; border-radius: 8px; background: #f8fafc; }
.translation-media-label { display: inline-flex; min-height: 28px; align-items: center; padding: 2px 9px; border-radius: 999px; color: #1e3a8a; background: #dbeafe; font-size: 13px; font-weight: 700; }
.translation-media-caption { min-width: 0; padding-top: 2px; color: #172033; line-height: 1.55; overflow-wrap: anywhere; }
.translation-media-caption [data-media-state] { color: var(--pdf-muted); }
```

保留现有 `.translation-block` 悬停、聚焦、固定和 reduced-motion 行为。

- [ ] **步骤 5：运行组件、样式和类型测试并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/pdf-styles.test.ts tests/unit/rendering/markdown-content.test.tsx
npm run typecheck
```

预期：媒体本体不在译文 HTML 中；四种标题状态正确；Markdown 安全边界、样式契约和类型检查通过。

- [ ] **步骤 6：提交媒体占位里程碑**

```powershell
git add web-translate-plugin/src/pdf/TranslationPane.tsx web-translate-plugin/entrypoints/pdf-workspace.content/style.css web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts
git commit -m "fix: render media caption placeholders"
```

---

### 任务 4：完成浏览器链路和发布门禁

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-formats-win32.png`
- 按实际首屏变化修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png`
- 修改：`AGENTS.md`

**接口：**

- 消费：任务 1 的 `caption`、任务 2 的严格请求/缓存、任务 3 的媒体占位 DOM。
- 产出：Windows Chromium 的媒体标题请求、占位、高亮和视觉回归证据。

- [ ] **步骤 1：把 E2E MinerU 夹具改成媒体 caption 真实形态**

在压缩包内容中加入：

```ts
{
  page_idx: 0,
  type: 'table',
  text: 'table OCR must not be translated',
  table_caption: ['Attention results'],
  table_body: '<table><tr><td>secret table cell</td></tr></table>',
  bbox: [100, 700, 900, 900],
},
{
  page_idx: 0,
  type: 'image',
  text: 'image OCR must not be translated',
  image_caption: ['Attention architecture'],
  img_path: 'images/secret-figure.png',
  bbox: [100, 460, 900, 560],
},
{ page_idx: 1, type: 'table', table_body: '<table><tr><td>no title</td></tr></table>' },
{ page_idx: 1, type: 'image', img_path: 'images/no-title.png' },
```

让本地 LLM 服务记录每次请求的 `blocks`，媒体 caption 分别返回“注意力结果”和“注意力架构”。

- [ ] **步骤 2：增加请求边界与占位失败断言**

在公开 PDF 用例中断言：

```ts
const serializedBlocks = JSON.stringify(observed.translationBlocks);
expect(serializedBlocks).toContain('Attention results');
expect(serializedBlocks).toContain('Attention architecture');
expect(serializedBlocks).not.toContain('secret table cell');
expect(serializedBlocks).not.toContain('secret-figure.png');
expect(serializedBlocks).not.toContain('table OCR must not be translated');
expect(serializedBlocks).not.toContain('image OCR must not be translated');

await expect(pageOne.locator('[data-media-kind="table"]')).toContainText('注意力结果');
await expect(pageOne.locator('[data-media-kind="figure"]')).toContainText('注意力架构');
await expect(pageOne.locator('.translation-page-body table')).toHaveCount(0);
await expect(pageOne.locator('.translation-page-body img')).toHaveCount(0);
await expect(pdfPage.locator('[data-translation-page="2"] [data-media-state]')).toHaveText(['无标题', '无标题']);
```

悬停媒体占位卡片，继续断言左侧 `.pdf-block-highlight` 可见。

- [ ] **步骤 3：构建并运行 E2E，确认旧实现红灯**

运行：

```powershell
npm run build
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

预期：媒体请求边界、占位 DOM 或旧视觉快照失败；不得因扩展未构建、端口冲突或 Provider 凭证失败。

- [ ] **步骤 4：更新视觉快照并逐张人工检查**

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts --update-snapshots
```

使用图像查看工具检查：

- 表格和图片占位卡片层级清楚，不出现真实 table 或 img。
- 翻译标题可读，无标题状态弱化但清晰。
- 占位卡片没有制造整页横向滚动或新的纵向滚动容器。
- 既有标题、公式、列表、Agent 面板和高亮视觉未退化。

- [ ] **步骤 5：无更新复跑 E2E 与完整发布门禁**

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts
npm run check
```

预期：E2E 3/3 通过；TypeScript、53 个 Vitest 文件、全部测试和 WXT Chrome MV3 构建通过。若测试总数因本计划新增用例增加，以零失败为准。

- [ ] **步骤 6：登记实施计划并提交验收改动**

确认 `AGENTS.md` 包含：

```markdown
- PDF 表格与图片标题翻译及占位渲染实施计划：`docs/superpowers/plans/2026-07-13-pdf-media-caption-placeholder-plan.md`
```

提交：

```powershell
git add AGENTS.md web-translate-plugin/tests/e2e/pdf-workspace.spec.ts web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-formats-win32.png web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png
git commit -m "test: verify media caption translation flow"
```

- [ ] **步骤 7：检查交付状态**

运行：

```powershell
git status --short
git log -7 --oneline
```

预期：工作树为空，最近提交包含 caption 模型、翻译与缓存、媒体占位和浏览器验收四个里程碑。

