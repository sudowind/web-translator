import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PDF 富文本与覆盖层样式契约', () => {
  it('高亮不拦截指针、TextLayer 可选择且固定状态不只依赖颜色', async () => {
    const css = await readFile(resolve('entrypoints/pdf-workspace.content/style.css'), 'utf8');
    expect(css).toMatch(/\.pdf-block-highlight-layer[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.pdf-text-layer[^}]*user-select:\s*text/s);
    expect(css).toContain('.pdf-text-layer ::selection');
    expect(css).toContain('.translation-block[data-pinned="true"]::after');
    expect(css).toContain('.markdown-table-wrap');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
