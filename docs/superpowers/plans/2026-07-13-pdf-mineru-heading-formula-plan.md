# PDF MinerU 标题层级与独立公式修复实施计划

> **面向执行智能体：** 必须使用 `superpowers:executing-plans` 按任务逐项执行；每个任务遵循 `superpowers:test-driven-development` 的红—绿—重构循环。当前项目按既有约定在当前会话内串行执行，不启用共享工作树中的并行实现。

**目标：** 保留 MinerU `text_level` 标题语义，正确渲染带显示定界符的独立公式，并通过文档结构版本自动淘汰旧解析缓存、复用既有翻译。

**架构：** 在 MinerU 规范化边界把上游 `text_level` 和公式定界符转换为稳定的 `DocumentModel`；译文组件只消费规范化后的 `headingLevel` 与 `latex`，不做文本猜测。`PdfWorkspaceService` 仅复用当前结构版本的文档缓存，旧版本重新解析后覆盖文档记录，但不改变翻译缓存键。

**技术栈：** TypeScript 7、React 19、WXT、MinerU `content_list.json`、KaTeX、Vitest、Playwright、Chrome MV3。

## 全局约束

- 所有规格、计划、测试名称和用户可见文案使用中文；代码标识符与官方字段名保留英文。
- 本迭代不修改 PDF.js TextLayer 的原生文字框选外观、选区几何或复制行为。
- 标题层级只读取 MinerU `text_level`；禁止根据编号、字体或 LLM 输出猜测。
- 独立公式不翻译，只渲染 MinerU 原始 LaTeX；不得全局替换反斜杠。
- `DocumentBlock.id`、页内顺序和翻译缓存键保持稳定。
- 开发阶段只运行受影响的定向测试；所有代码和快照稳定后只运行一次完整 `npm run check` 和一次无更新 E2E。
- 不读取、打印或提交 `.llm-experiment.local.json`、`.mineru-experiment.local.json` 中的凭证。

## 文件结构

- `web-translate-plugin/src/document/model.ts`：声明文档结构版本和标题层级字段。
- `web-translate-plugin/src/document/normalize-mineru.ts`：把 MinerU `text_level` 与独立公式文本转换为内部模型。
- `web-translate-plugin/src/pdf/TranslationPane.tsx`：按标题层级选择 `h3`–`h6`，使用规范化 LaTeX 渲染独立公式。
- `web-translate-plugin/src/pdf/workspace-service.ts`：只复用当前结构版本的文档缓存。
- `web-translate-plugin/entrypoints/pdf-workspace.content/style.css`：定义标题字号梯度和独立公式布局。
- `web-translate-plugin/tests/unit/document/normalize-mineru.test.ts`：覆盖 MinerU 官方输入结构、非法层级和公式去定界。
- `web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`：覆盖标题语义元素与 KaTeX 输出。
- `web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`：锁定标题和公式 CSS 契约。
- `web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`：覆盖文档缓存版本与翻译缓存复用。
- `web-translate-plugin/tests/unit/agent/context-builder.test.ts`、`web-translate-plugin/tests/unit/storage/repositories.test.ts`：补齐强类型模型夹具的结构版本。
- `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`：使用真实 MinerU 形态验证整条 PDF 工作台链路。
- `web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png`、`rich-translation-formats-win32.png`：更新标题与公式视觉基线。

---

### 任务 1：保留 MinerU 标题层级并规范化独立公式

**文件：**

- 修改：`web-translate-plugin/src/document/model.ts`
- 修改：`web-translate-plugin/src/document/normalize-mineru.ts`
- 修改：`web-translate-plugin/tests/unit/document/normalize-mineru.test.ts`
- 修改：`web-translate-plugin/tests/unit/agent/context-builder.test.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`
- 修改：`web-translate-plugin/tests/unit/storage/repositories.test.ts`

**接口：**

- 产出：`export const DOCUMENT_SCHEMA_VERSION = 2`。
- 产出：`DocumentModel.schemaVersion: number`。
- 产出：`DocumentBlock.headingLevel?: number`，只保存 MinerU 的正整数标题级别。
- 保持：`DocumentBlock.text` 保存 MinerU 原始文本；`DocumentBlock.latex` 保存可直接传给 KaTeX 的内部公式。

- [ ] **步骤 1：写入 MinerU 官方形态的失败测试**

在 `normalize-mineru.test.ts` 增加以下用例；先不修改生产代码：

```ts
it('使用 text_level 区分正文与各级标题并保留原始层级', () => {
  const model = normalizeMineru([
    { page_idx: 0, type: 'text', text: 'Body', text_level: 0, bbox: [10, 20, 30, 40] },
    { page_idx: 0, type: 'text', text: 'Section', text_level: 1, bbox: [10, 50, 30, 70] },
    { page_idx: 0, type: 'text', text: 'Subsection', text_level: 3, bbox: [10, 80, 30, 100] },
    { page_idx: 0, type: 'title', text: 'Legacy title', bbox: [10, 110, 30, 130] },
  ], { ...metadata, pageCount: 1 });

  expect(model.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
  expect(model.pages[0].blocks).toMatchObject([
    { kind: 'paragraph', text: 'Body' },
    { kind: 'heading', text: 'Section', headingLevel: 1 },
    { kind: 'heading', text: 'Subsection', headingLevel: 3 },
    { kind: 'heading', text: 'Legacy title', headingLevel: 1 },
  ]);
});

it('去除独立公式的显示定界符但保留原始文本和公式编号', () => {
  const source = '$$\n\\operatorname{Attention}(Q,K,V)=QK^T\\tag{1}\n$$';
  const bracketed = '\\[ x^2 + y^2 \\]';
  const model = normalizeMineru([
    { page_idx: 0, type: 'equation', text: source },
    { page_idx: 0, type: 'equation', text: bracketed },
    { page_idx: 0, type: 'equation', text: 'E=mc^2' },
  ], { ...metadata, pageCount: 1 });

  expect(model.pages[0].blocks).toMatchObject([
    { kind: 'formula', text: source, latex: '\\operatorname{Attention}(Q,K,V)=QK^T\\tag{1}' },
    { kind: 'formula', text: bracketed, latex: 'x^2 + y^2' },
    { kind: 'formula', text: 'E=mc^2', latex: 'E=mc^2' },
  ]);
});

it.each([-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
  '拒绝非法 text_level：%j',
  (text_level) => {
    expect(() => normalizeMineru(
      [{ page_idx: 0, type: 'text', text: 'secret heading', text_level }],
      { ...metadata, pageCount: 1 },
    )).toThrowError(expect.objectContaining({ code: 'MINERU_FIELD_INVALID' }));
  },
);
```

同时从 `model.ts` 导入 `DOCUMENT_SCHEMA_VERSION`。测试必须使用 `type: "text" + text_level`，不再把 `type: "title"` 当作唯一正常路径。

- [ ] **步骤 2：运行定向测试并确认红灯原因正确**

运行：

```powershell
npx vitest run tests/unit/document/normalize-mineru.test.ts
```

预期：失败信息表明 `schemaVersion`、`headingLevel` 缺失，`text_level` 标题仍是 `paragraph`，且 `latex` 仍包含 `$$` 或 `\[ ... \]`；不能是语法错误或测试夹具错误。

- [ ] **步骤 3：实现文档结构与 MinerU 规范化**

在 `model.ts` 增加明确的结构版本和字段：

```ts
export const DOCUMENT_SCHEMA_VERSION = 2;

export interface DocumentBlock {
  id: string;
  pageId: string;
  order: number;
  kind: BlockKind;
  text: string;
  headingLevel?: number;
  latex?: string;
  html?: string;
  resourceUrl?: string;
  polygon?: number[];
}

export interface DocumentModel {
  schemaVersion: number;
  id: string;
  sourceUrl: string;
  hash: string;
  title: string;
  pageCount: number;
  pages: DocumentPage[];
}
```

在 `normalize-mineru.ts` 导入版本常量，并用以下边界函数处理上游字段：

```ts
function optionalTextLevel(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MineruDataError('MINERU_FIELD_INVALID');
  }
  return value as number;
}

function normalizeFormulaLatex(value: string): string {
  const trimmed = value.trim();
  const dollars = /^\$\$([\s\S]*?)\$\$$/.exec(trimmed);
  const brackets = /^\\\[([\s\S]*?)\\\]$/.exec(trimmed);
  const latex = (dollars?.[1] ?? brackets?.[1] ?? trimmed).trim();
  if (!latex) throw new MineruDataError('MINERU_FIELD_INVALID');
  return latex;
}
```

在区块循环中先读取 `text_level`，再决定类型并建立区块：

```ts
const textLevel = optionalTextLevel(value.text_level);
const baseKind = kinds[type] ?? 'other';
const kind: BlockKind = type === 'text' && (textLevel ?? 0) > 0
  ? 'heading'
  : baseKind;
const headingLevel = kind === 'heading'
  ? (type === 'title' ? 1 : textLevel)
  : undefined;
const latex = kind === 'formula' ? normalizeFormulaLatex(normalizedText) : undefined;

page.blocks.push({
  id: blockId(normalizedMetadata.hash, pageIndex as number, order),
  pageId: page.id,
  order,
  kind,
  text: normalizedText,
  ...(headingLevel === undefined ? {} : { headingLevel }),
  ...(latex === undefined ? {} : { latex }),
  ...(html === undefined ? {} : { html }),
  ...(imagePath === undefined ? {} : { resourceUrl: imagePath }),
  ...((polygon ?? bbox) === undefined ? {} : { polygon: polygon ?? bbox }),
});
```

最终模型必须写入版本：

```ts
return {
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  id: normalizedMetadata.hash,
  ...normalizedMetadata,
  pages,
};
```

给四个显式 `DocumentModel` 测试夹具增加 `schemaVersion: DOCUMENT_SCHEMA_VERSION` 并导入常量，不在生产类型上把该字段改成可选来绕过测试。

- [ ] **步骤 4：运行规范化测试和类型检查并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/document/normalize-mineru.test.ts tests/unit/agent/context-builder.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/workspace-service.test.ts tests/unit/storage/repositories.test.ts
npm run typecheck
```

预期：五个测试文件全部通过，TypeScript 无缺失 `schemaVersion` 或字段类型错误。

- [ ] **步骤 5：提交 MinerU 语义规范化**

```powershell
git add src/document/model.ts src/document/normalize-mineru.ts tests/unit/document/normalize-mineru.test.ts tests/unit/agent/context-builder.test.ts tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/workspace-service.test.ts tests/unit/storage/repositories.test.ts
git commit -m "fix: preserve MinerU headings and formulas"
```

---

### 任务 2：按标题级别渲染译文并完善独立公式样式

**文件：**

- 修改：`web-translate-plugin/src/pdf/TranslationPane.tsx`
- 修改：`web-translate-plugin/entrypoints/pdf-workspace.content/style.css`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-components.test.tsx`
- 修改：`web-translate-plugin/tests/unit/pdf/pdf-styles.test.ts`

**接口：**

- 消费：任务 1 的 `DocumentBlock.headingLevel?: number` 与规范化 `DocumentBlock.latex`。
- 产出：`headingTagForLevel(level?: number): 'h3' | 'h4' | 'h5' | 'h6'`，保持为 `TranslationPane.tsx` 内部纯函数。
- 保持：公式容器类名 `.translation-formula`，不改变区块 ID、高亮事件或 Markdown 安全边界。

- [ ] **步骤 1：写入标题元素、公式成功输出和 CSS 契约失败测试**

把 `workspace-components.test.tsx` 的第一页夹具扩展为四个标题层级，并使用已规范化的编号公式：

```ts
{ id: 'h1', pageId: 'p1', order: 0, kind: 'heading', headingLevel: 1, text: 'Heading 1' },
{ id: 'h2', pageId: 'p1', order: 1, kind: 'heading', headingLevel: 2, text: 'Heading 2' },
{ id: 'h3', pageId: 'p1', order: 2, kind: 'heading', headingLevel: 3, text: 'Heading 3' },
{ id: 'h8', pageId: 'p1', order: 3, kind: 'heading', headingLevel: 8, text: 'Heading 8' },
{ id: 'f1', pageId: 'p1', order: 4, kind: 'formula', text: '$$ x^2 \\tag{1} $$', latex: 'x^2 \\tag{1}' },
```

渲染后增加断言：

```ts
expect(html).toContain('<h3>');
expect(html).toContain('<h4>');
expect(html).toContain('<h5>');
expect(html).toContain('<h6>');
expect(html).toContain('class="translation-formula"');
expect(html).toContain('class="katex-display"');
expect(html).not.toContain('katex-error');
```

在 `pdf-styles.test.ts` 增加：

```ts
expect(css).toContain('.translation-block[data-block-kind="heading"] > h3');
expect(css).toContain('.translation-block[data-block-kind="heading"] > h4');
expect(css).toContain('.translation-block[data-block-kind="heading"] > h5');
expect(css).toContain('.translation-block[data-block-kind="heading"] > h6');
expect(css).toMatch(/\.translation-formula[^}]*overflow-x:\s*auto/s);
expect(css).toContain('.translation-formula .katex-display');
```

- [ ] **步骤 2：运行组件与样式测试并确认红灯原因正确**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/pdf-styles.test.ts
```

预期：当前所有标题仍输出 `h3`，且新增标题层级 CSS 选择器不存在；公式不应因测试输入语法错误而失败。

- [ ] **步骤 3：实现动态标题元素和稳定公式布局**

在 `TranslationPane.tsx` 增加内部映射函数：

```ts
type HeadingTag = 'h3' | 'h4' | 'h5' | 'h6';

function headingTagForLevel(level = 1): HeadingTag {
  if (level <= 1) return 'h3';
  if (level === 2) return 'h4';
  if (level === 3) return 'h5';
  return 'h6';
}
```

替换固定 `h3` 分支：

```tsx
if (block.kind === 'heading') {
  const Heading = headingTagForLevel(block.headingLevel);
  return <Heading><MarkdownContent content={content} inline /></Heading>;
}
```

公式分支继续只读取规范化结果：

```tsx
if (block.kind === 'formula') {
  const markup = katex.renderToString(block.latex ?? block.text, {
    throwOnError: false,
    displayMode: true,
  });
  return <div className="translation-formula" dangerouslySetInnerHTML={{ __html: markup }} />;
}
```

在 `style.css` 使用明确层级和现有 4/8px 间距节奏：

```css
.translation-block[data-block-kind="heading"] > :is(h3, h4, h5, h6) {
  margin: 12px 0 6px;
  color: #0f172a;
  line-height: 1.35;
  font-weight: 700;
}
.translation-block[data-block-kind="heading"] > h3 { font-size: 21px; }
.translation-block[data-block-kind="heading"] > h4 { font-size: 18px; }
.translation-block[data-block-kind="heading"] > h5 { font-size: 16.5px; }
.translation-block[data-block-kind="heading"] > h6 { font-size: 15.5px; }
.translation-formula { max-width: 100%; overflow-x: auto; padding: 12px 0; }
.translation-formula .katex-display { width: max-content; min-width: 100%; margin: 0; text-align: center; }
```

不要修改 `.pdf-text-layer ::selection`，也不要加入自绘选区。

- [ ] **步骤 4：运行组件、样式和类型检查并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/pdf-styles.test.ts
npm run typecheck
```

预期：标题分别生成 `h3`–`h6`，合法编号公式没有 `katex-error`，CSS 契约与 TypeScript 全部通过。

- [ ] **步骤 5：提交译文语义渲染**

```powershell
git add src/pdf/TranslationPane.tsx entrypoints/pdf-workspace.content/style.css tests/unit/pdf/workspace-components.test.tsx tests/unit/pdf/pdf-styles.test.ts
git commit -m "fix: render PDF heading levels and display math"
```

---

### 任务 3：按文档结构版本刷新旧缓存并复用翻译

**文件：**

- 修改：`web-translate-plugin/src/pdf/workspace-service.ts`
- 修改：`web-translate-plugin/tests/unit/pdf/workspace-service.test.ts`

**接口：**

- 消费：任务 1 的 `DOCUMENT_SCHEMA_VERSION` 与 `DocumentModel.schemaVersion`。
- 保持：`TranslationKey.schema` 仍为 `1`，`getTranslation` 和 `putTranslation` 接口不变。
- 行为：只有 `cached.schemaVersion === DOCUMENT_SCHEMA_VERSION` 才提前返回文档缓存。

- [ ] **步骤 1：写入当前缓存命中、旧缓存重解析与翻译复用失败测试**

在 `workspace-service.test.ts` 增加三个行为断言。当前版本命中用例：

```ts
it('当前文档结构版本直接命中且不创建 MinerU 任务', async () => {
  const createMineru = vi.fn();
  const service = makeService(undefined, {
    getDocument: vi.fn().mockResolvedValue(model),
    createMineru,
  });
  await expect(service.handle(
    { type: 'pdf:parse-start', source, pageCount: 1, consent: false },
    7,
  )).resolves.toEqual(model);
  expect(createMineru).not.toHaveBeenCalled();
});
```

旧版本重解析用例：

```ts
it('旧文档结构版本重新解析并覆盖文档缓存', async () => {
  const oldModel = { ...model, schemaVersion: DOCUMENT_SCHEMA_VERSION - 1 };
  const putDocument = vi.fn();
  const createUrlTask = vi.fn().mockResolvedValue({ kind: 'single', id: 's1' });
  const service = makeService({
    createUrlTask,
    createUploadTask: vi.fn(),
    waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
  }, {
    getDocument: vi.fn().mockResolvedValue(oldModel),
    loadMineru: vi.fn().mockResolvedValue(model),
    putDocument,
  });
  await expect(service.handle(
    { type: 'pdf:parse-start', source, pageCount: 1, consent: false },
    7,
  )).resolves.toEqual(model);
  expect(createUrlTask).toHaveBeenCalledOnce();
  expect(putDocument).toHaveBeenCalledWith(model);
});
```

翻译复用用例使用内存变量模拟文档覆盖：

```ts
it('旧文档重解析后继续复用相同区块 ID 的翻译缓存', async () => {
  let stored: DocumentModel = { ...model, schemaVersion: DOCUMENT_SCHEMA_VERSION - 1 };
  const cachedTranslation = [{ id: 'b1', text: '已有译文' }];
  const createOpenAi = vi.fn();
  const service = makeService({
    createUrlTask: vi.fn().mockResolvedValue({ kind: 'single', id: 's1' }),
    createUploadTask: vi.fn(),
    waitForResult: vi.fn().mockResolvedValue({ state: 'done', fullZipUrl: 'https://cdn.test/r.zip' }),
  }, {
    getDocument: vi.fn(async () => stored),
    putDocument: vi.fn(async (next: DocumentModel) => { stored = next; }),
    loadMineru: vi.fn().mockResolvedValue(model),
    getTranslation: vi.fn().mockResolvedValue({ blocks: cachedTranslation }),
    createOpenAi,
  });

  await service.handle({ type: 'pdf:parse-start', source, pageCount: 1, consent: false }, 7);
  await expect(service.handle(
    { type: 'pdf:translate-page', hash: source.hash, page: 1 },
    7,
  )).resolves.toEqual(cachedTranslation);
  expect(createOpenAi).not.toHaveBeenCalled();
});
```

从 `model.ts` 导入 `DOCUMENT_SCHEMA_VERSION`。

- [ ] **步骤 2：运行工作台服务测试并确认红灯原因正确**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-service.test.ts
```

预期：旧版本用例失败，因为当前服务对任意 `cached` 都直接返回；当前版本命中用例保持通过。

- [ ] **步骤 3：实现最小缓存版本判断**

在 `workspace-service.ts` 导入版本常量：

```ts
import { DOCUMENT_SCHEMA_VERSION, type DocumentModel } from '../document/model';
```

把 `parse` 的缓存短路改为：

```ts
const cached = await this.dependencies.getDocument(source.hash);
if (cached?.schemaVersion === DOCUMENT_SCHEMA_VERSION) return cached;
```

不要调用 `clearCache`，因为它会一并删除可复用的翻译；新模型由现有 `putDocument(model)` 覆盖旧记录。

- [ ] **步骤 4：运行服务测试、相关存储测试与类型检查并确认绿灯**

运行：

```powershell
npx vitest run tests/unit/pdf/workspace-service.test.ts tests/unit/storage/repositories.test.ts
npm run typecheck
```

预期：当前版本直接命中，旧版本只重新解析一次，翻译缓存被复用，所有测试和类型检查通过。

- [ ] **步骤 5：提交缓存升级**

```powershell
git add src/pdf/workspace-service.ts tests/unit/pdf/workspace-service.test.ts
git commit -m "fix: refresh stale PDF document cache"
```

---

### 任务 4：更新官方形态 E2E、视觉基线并执行最终门禁

**文件：**

- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png`
- 修改：`web-translate-plugin/tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-formats-win32.png`
- 修改：`AGENTS.md`

**接口：**

- 消费：任务 1–3 的 MinerU 规范化、语义渲染和缓存版本行为。
- 产出：固定 MinerU 官方结构的端到端回归与 Windows 视觉基线。
- 保持：Agent 流式、区块高亮、PDF 文本选择、失败诊断和认证上传断言全部保留。

- [ ] **步骤 1：先把 E2E 固定数据改为真实 MinerU 形态并加入失败断言**

把第一页固定数据中的标题和公式改为：

```ts
{ page_idx: 0, type: 'text', text: 'Paper title', text_level: 1, bbox: [100, 80, 900, 150] },
{ page_idx: 0, type: 'text', text: '3.2.1 Scaled Dot-Product Attention', text_level: 3, bbox: [100, 160, 900, 210] },
{ page_idx: 0, type: 'text', text: 'Introduction with x squared', bbox: [100, 220, 900, 400] },
{ page_idx: 0, type: 'equation', text: '$$\n\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V\\tag{1}\n$$', bbox: [200, 580, 800, 680] },
```

第二页标题改为 `type: 'text', text_level: 1`。翻译夹具继续根据 `block.kind === 'heading'` 返回标题文本。

在公开 PDF 用例中增加精确断言：

```ts
await expect(pageOne.locator('[data-block-kind="heading"] h3')).toContainText('论文标题');
await expect(pageOne.locator('[data-block-kind="heading"] h5')).toContainText('3.2.1 缩放点积注意力');
const displayFormula = pageOne.locator('[data-block-kind="formula"] .katex-display');
await expect(displayFormula).toBeVisible();
await expect(pageOne.locator('[data-block-kind="formula"] .katex-error')).toHaveCount(0);
await expect(pageOne.locator('[data-block-kind="formula"]')).toContainText('(1)');
```

为了区分两个标题的译文，服务夹具按输入文本返回：论文标题返回 `**论文标题**`，`3.2.1` 标题返回 `**3.2.1 缩放点积注意力**`。不要使用位置选择器替代稳定的 `data-block-kind` 和标题元素。

- [ ] **步骤 2：运行 E2E 并确认旧实现或旧快照产生红灯**

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts
```

预期：在生产实现尚未完整时语义或公式断言失败；任务 1–3 已完成时，至少两个富文本视觉快照因标题字号和公式排版变化而失败。失败不能来自扩展未构建或服务器端口冲突。

- [ ] **步骤 3：更新视觉快照并逐张人工检查**

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts --update-snapshots
```

预期：3 个 E2E 用例通过并更新受影响快照。随后使用图像查看工具检查：

- 一级标题大于三级标题，三级标题仍明显区别于正文。
- Attention 公式居中、编号 `(1)` 可见、没有红色源码。
- 公式和标题没有制造整页横向滚动。
- PDF 左侧原生文字框选相关 CSS 和 E2E 选择断言未改变。

如视觉检查不合格，先调整 `style.css`，只运行本任务 E2E 并再次更新快照，直至满足上述四项。

- [ ] **步骤 4：运行一次无更新 E2E 与一次完整发布门禁**

运行：

```powershell
npx playwright test tests/e2e/pdf-workspace.spec.ts
npm run check
```

预期：E2E 3/3 通过；`npm run check` 中 TypeScript、全部 Vitest 和 WXT Chrome MV3 构建均通过。不得在没有代码变化时重复运行同一完整命令。

- [ ] **步骤 5：登记计划并提交最终验证变更**

确认 `AGENTS.md` 的“当前规格记录”同时包含本计划：

```markdown
- PDF MinerU 标题层级与独立公式修复实施计划：`docs/superpowers/plans/2026-07-13-pdf-mineru-heading-formula-plan.md`
```

提交：

```powershell
git add tests/e2e/pdf-workspace.spec.ts tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-page-win32.png tests/e2e/pdf-workspace.spec.ts-snapshots/rich-translation-formats-win32.png AGENTS.md
git commit -m "test: verify MinerU heading and formula rendering"
```

- [ ] **步骤 6：检查交付状态**

运行：

```powershell
git status --short
git log -5 --oneline
```

预期：工作树为空；最近提交包含规范化、渲染、缓存和 E2E 四个独立里程碑。向用户说明需要在 `chrome://extensions` 重新加载扩展并刷新论文页面；旧文档结构会自动重新解析，既有翻译缓存按区块 ID 复用。
