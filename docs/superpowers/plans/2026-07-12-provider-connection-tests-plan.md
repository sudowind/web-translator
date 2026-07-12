# Provider 独立连接测试实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施；所有步骤使用复选框跟踪。

**目标：** 将设置页的 LLM 与 MinerU 测试拆分，明确 404 的 Provider 归属，并阻止 MinerU 文档页被当作 API 根地址保存。

**架构：** 保留现有设置存储与精确 Origin 授权。`provider-access.ts` 负责 Provider 专用规范化；`test-provider.ts` 只处理真实 LLM 网络测试，MinerU 配置检查直接在设置页调用纯校验并申请权限，不创建解析任务。设置页为两个 Provider 维护独立活动状态和就近反馈。

**技术栈：** React 19、TypeScript、WXT、Vitest、Chrome MV3。

## 全局约束

- 所有 plan/spec 使用中文。
- MinerU 配置检查不得调用 fetch、不得创建解析任务或消耗额度。
- MinerU 地址只接受 HTTPS Origin 根地址，规范化结果不包含路径、query 或 fragment。
- LLM 地址继续允许 `/v1` 等 OpenAI 兼容路径。
- 凭据和 Provider 原始响应不得进入错误消息或页面 DOM。
- 开发中只跑受影响测试；最终统一运行 `npm run check`。

---

## 文件结构

- 修改 `web-translate-plugin/src/settings/provider-access.ts`：新增 MinerU 根地址规范化函数，并在完整设置校验中使用。
- 修改 `web-translate-plugin/src/settings/test-provider.ts`：将现有连接测试和消息命名明确为 LLM，返回带 Provider 归属的安全错误。
- 修改 `web-translate-plugin/entrypoints/options/App.tsx`：拆分两个 Provider 区域的按钮、活动状态和反馈。
- 修改 `web-translate-plugin/tests/unit/settings/provider-access.test.ts`：覆盖 MinerU 根地址边界。
- 修改 `web-translate-plugin/tests/unit/settings/test-provider.test.ts`：覆盖 LLM 独立测试和错误归属。
- 新增或修改 `web-translate-plugin/tests/unit/settings/options-provider-actions.test.tsx`：覆盖设置页两个按钮、独立状态和无网络 MinerU 检查。

### 任务 1：建立 Provider 专用校验与测试契约

**文件：**

- 修改：`web-translate-plugin/src/settings/provider-access.ts`
- 修改：`web-translate-plugin/src/settings/test-provider.ts`
- 测试：`web-translate-plugin/tests/unit/settings/provider-access.test.ts`
- 测试：`web-translate-plugin/tests/unit/settings/test-provider.test.ts`

**接口：**

- 产出：`normalizeMineruBaseUrl(value: string): string`
- 产出：`testLlmConnection(settings, createClient?): Promise<{ connected: true }>`
- 消费：既有 `authorizeProviderSettings()`、`validateProviderSettings()` 和 `OpenAiTranslationClient.translate()`。

- [ ] **步骤 1：先写 MinerU 根地址失败测试**

在 `provider-access.test.ts` 增加：

```ts
import { normalizeMineruBaseUrl } from '../../../src/settings/provider-access';

it('只接受 MinerU HTTPS Origin 根地址', () => {
  expect(normalizeMineruBaseUrl('https://mineru.net/')).toBe('https://mineru.net');
  expect(() => normalizeMineruBaseUrl('https://mineru.net/apiManage/docs'))
    .toThrow('MinerU 接口地址必须填写 API 根地址');
  expect(() => normalizeMineruBaseUrl('https://mineru.net/?from=docs'))
    .toThrow('MinerU 接口地址必须填写 API 根地址');
});
```

- [ ] **步骤 2：运行测试确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/provider-access.test.ts
```

预期：因 `normalizeMineruBaseUrl` 不存在而失败。

- [ ] **步骤 3：实现最小 MinerU 根地址规范化**

在 `provider-access.ts` 增加并接入 `validateProviderSettings()`：

```ts
export function normalizeMineruBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('MinerU 接口地址必须使用无凭据的 HTTPS URL');
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('MinerU 接口地址必须填写 API 根地址，例如 https://mineru.net');
  }
  return url.origin;
}
```

MinerU Token 非空时，保存的 `mineru.baseUrl` 必须取该函数返回值；LLM 继续使用既有路径规则。

- [ ] **步骤 4：先写 LLM 错误归属失败测试**

在 `test-provider.test.ts` 把测试目标改为 `testLlmConnection`，并增加：

```ts
it('把 HTTP 失败明确归属到 LLM', async () => {
  const translate = vi.fn().mockRejectedValue(new Error('翻译请求失败 (404)'));
  await expect(testLlmConnection(settings, () => ({ translate })))
    .rejects.toThrow('LLM 请求失败（HTTP 404）');
});
```

- [ ] **步骤 5：运行测试确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/test-provider.test.ts
```

预期：因新函数或新错误文案不存在而失败。

- [ ] **步骤 6：实现 LLM 专用测试和安全错误映射**

将现有测试函数更名为 `testLlmConnection`，保持最小翻译请求；捕获错误并只映射已知 HTTP 状态：

```ts
function llmConnectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  const status = /\((\d{3})\)/.exec(message)?.[1];
  return status
    ? new Error(`LLM 请求失败（HTTP ${status}），请检查接口地址、模型和 API Key`)
    : new Error('LLM 连接失败，请检查接口地址、模型和 API Key');
}
```

消息仍限制为扩展设置页调用，且不得回传响应正文或凭据。

- [ ] **步骤 7：运行定向测试确认 GREEN**

运行：

```powershell
npm test -- tests/unit/settings/provider-access.test.ts tests/unit/settings/test-provider.test.ts
```

预期：两个测试文件全部通过。

- [ ] **步骤 8：提交任务 1**

```powershell
git add web-translate-plugin/src/settings/provider-access.ts web-translate-plugin/src/settings/test-provider.ts web-translate-plugin/tests/unit/settings/provider-access.test.ts web-translate-plugin/tests/unit/settings/test-provider.test.ts
git commit -m "fix: separate provider validation"
```

### 任务 2：拆分设置页 Provider 操作与反馈

**文件：**

- 修改：`web-translate-plugin/entrypoints/options/App.tsx`
- 修改：`web-translate-plugin/entrypoints/options/style.css`
- 创建：`web-translate-plugin/tests/unit/settings/options-provider-actions.test.tsx`
- 修改：`web-translate-plugin/README.md`

**接口：**

- 消费：`testLlmConnection` 对应的 runtime 消息。
- 消费：`normalizeMineruBaseUrl()` 与 `authorizeProviderSettings()`。
- 产出：独立按钮“测试 LLM”“检查 MinerU 配置”和两个 `aria-live="polite"` 反馈区域。

- [ ] **步骤 1：先写设置页交互失败测试**

使用 SSR 或现有 React 测试模式，至少断言：

```tsx
it('分别呈现 LLM 测试和无额度 MinerU 检查', () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('测试 LLM');
  expect(html).toContain('检查 MinerU 配置');
  expect(html).toContain('尚未创建解析任务');
  expect(html).not.toContain('>测试连接<');
});
```

若 SSR 无法覆盖按钮行为，提取并导出纯函数：

```ts
export function mineruReadyMessage(): string {
  return 'MinerU：配置与权限已就绪，尚未创建解析任务';
}
```

- [ ] **步骤 2：运行测试确认 RED**

运行：

```powershell
npm test -- tests/unit/settings/options-provider-actions.test.tsx
```

预期：因独立按钮或文案不存在而失败。

- [ ] **步骤 3：实现独立状态与按钮**

把单一 `Activity` 改为：

```ts
type Activity = 'loading' | 'idle' | 'saving' | 'testing-llm' | 'checking-mineru';
```

实现：

- `testLlm()`：申请完整表单所需权限后发送 LLM 测试消息；只更新 `llmFeedback`。
- `checkMineru()`：要求 Token 非空，调用 MinerU 根地址校验并只申请 MinerU Origin；不发送 Provider 网络消息；只更新 `mineruFeedback`。
- 保存按钮反馈改为“设置已保存”。
- LLM 字段标签增加 `LLM` 前缀；MinerU 帮助文字说明只填根地址、Token 不带 `Bearer`。

两个状态区域使用：

```tsx
<p className="provider-status" aria-live="polite">{llmFeedback}</p>
<p className="provider-status" aria-live="polite">{mineruFeedback}</p>
```

- [ ] **步骤 4：补齐交互可访问性样式**

在 `style.css` 中复用现有按钮样式，并保证：

- 按钮最小高度 44px。
- `:focus-visible` 保留清晰轮廓。
- 成功与失败同时包含文字，不只依赖颜色。
- 加载时按钮 `disabled` 且文案分别为“测试中…”和“检查中…”。

- [ ] **步骤 5：运行设置相关测试确认 GREEN**

运行：

```powershell
npm test -- tests/unit/settings/provider-access.test.ts tests/unit/settings/test-provider.test.ts tests/unit/settings/options-provider-actions.test.tsx tests/unit/settings/store.test.ts
```

预期：全部通过。

- [ ] **步骤 6：更新使用说明**

在 `README.md` 的 Provider 配置章节写清：

- LLM 测试会发起最小请求。
- MinerU 配置检查不创建任务、不验证 Token 的真实可用性。
- MinerU 真实可用性在用户启用 PDF 解析时验证。
- MinerU 地址填写 `https://mineru.net`，不得填写文档页。

- [ ] **步骤 7：运行完整门禁**

运行：

```powershell
npm run check
```

预期：类型检查、全部 Vitest 和 Chrome MV3 构建通过。

- [ ] **步骤 8：提交任务 2**

```powershell
git add web-translate-plugin/entrypoints/options web-translate-plugin/tests/unit/settings web-translate-plugin/README.md
git commit -m "feat: split provider connection checks"
```
