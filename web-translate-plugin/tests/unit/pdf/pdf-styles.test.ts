import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PDF 富文本与覆盖层样式契约', () => {
  it('使用学术靛蓝主题、无框阅读流和紧凑媒体信息行', async () => {
    const css = await readFile(resolve('entrypoints/pdf-workspace.content/style.css'), 'utf8');
    expect(css).toContain('--pdf-primary: #4f46e5');
    expect(css).toContain('--pdf-primary-soft: #eef2ff');
    expect(css).not.toMatch(/#a16207|#fef3c7|#fde68a|rgb\(250 204 21/i);
    expect(css).not.toContain('.translation-block[data-pinned="true"]::after');
    expect(css).toMatch(/\.translation-block\[data-pinned="true"\][^}]*box-shadow:\s*inset 2px 0 var\(--pdf-primary\)/s);
    expect(css).toMatch(/\.page-pair-pdf[^}]*border:\s*0/s);
    expect(css).toMatch(/\.page-pair-translation[^}]*border:\s*0/s);
    expect(css).toMatch(/\.translation-media-placeholder[^}]*min-height:\s*5[02]px/s);
    expect(css).not.toMatch(/\.translation-media-placeholder[^}]*border:\s*1px dashed/s);
    expect(css).toMatch(/\.workspace-content\.agent-closed[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) 180px');
    expect(css).toContain('@media (max-width: 899px)');
  });

  it('高亮不拦截指针、TextLayer 可选择且富文本格式保持完整', async () => {
    const css = await readFile(resolve('entrypoints/pdf-workspace.content/style.css'), 'utf8');
    expect(css).toMatch(/\.pdf-block-highlight-layer[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.pdf-text-layer[^}]*user-select:\s*text/s);
    expect(css).toContain('.pdf-text-layer ::selection');
    expect(css).toContain('.markdown-table-wrap');
    expect(css).toContain('.translation-block[data-block-kind="heading"] > h3');
    expect(css).toContain('.translation-block[data-block-kind="heading"] > h4');
    expect(css).toContain('.translation-block[data-block-kind="heading"] > h5');
    expect(css).toContain('.translation-block[data-block-kind="heading"] > h6');
    expect(css).toMatch(/\.translation-formula[^}]*overflow-x:\s*auto/s);
    expect(css).toContain('.translation-formula .katex-display');
    expect(css).toContain('.translation-media-placeholder');
    expect(css).toContain('.translation-media-label');
    expect(css).toContain('.translation-media-caption');
    expect(css).toContain('[data-media-state]');
    expect(css).toMatch(/\.translation-page-body[^}]*overflow-x:\s*hidden/s);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
