import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import { buildAgentContext } from '../../../src/agent/context-builder';

const model: DocumentModel = {
  id: 'h', sourceUrl: 'https://x.test/p.pdf', hash: 'h', title: 'Paper', pageCount: 2,
  pages: [
    { id: 'p1', index: 0, blocks: [{ id: 'b1', pageId: 'p1', order: 0, kind: 'heading', text: 'Introduction' }, { id: 'b2', pageId: 'p1', order: 1, kind: 'paragraph', text: 'Background' }] },
    { id: 'p2', index: 1, blocks: [{ id: 'b3', pageId: 'p2', order: 0, kind: 'heading', text: 'Results' }, { id: 'b4', pageId: 'p2', order: 1, kind: 'paragraph', text: 'Main contribution' }] },
  ],
};

describe('整篇论文上下文', () => {
  it('预算足够时按页完整包含整篇和固定引用', () => {
    const context = buildAgentContext({ model, activePage: 2, selection: '', recentMessages: [], maxCharacters: 10000 });
    expect(context.mode).toBe('full');
    expect(context.text).toContain('[p:1]\nIntroduction\nBackground');
    expect(context.text).toContain('[p:2]\nResults\nMain contribution');
  });

  it('超限时披露 compressed 并包含所有页摘要、当前页全文和选中文本', () => {
    const context = buildAgentContext({ model, activePage: 2, selection: 'selected evidence', recentMessages: [], maxCharacters: 20 });
    expect(context.mode).toBe('compressed');
    expect(context.notice).toContain('压缩上下文');
    expect(context.text).toContain('[p:1] Introduction');
    expect(context.text).toContain('[p:2]\nResults\nMain contribution');
    expect(context.text).toContain('selected evidence');
  });
});
