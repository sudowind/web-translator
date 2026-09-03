import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../../src/document/model';
import {
  defaultTranslationMode,
  isLongPdfDocument,
  translatableCharacterCount,
} from '../../../src/translation/document-policy';

function makeModel(pageCount: number, text = 'text'): DocumentModel {
  return {
    schemaVersion: 3,
    id: 'h',
    sourceUrl: 'https://example.test/p.pdf',
    hash: 'h',
    title: 'P',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: `p${index + 1}`,
      index,
      blocks: [{ id: `b${index + 1}`, pageId: `p${index + 1}`, order: 0, kind: 'paragraph' as const, text }],
    })),
  };
}

describe('PDF 长文档翻译策略', () => {
  it('30 页及以上默认按需翻译', () => {
    expect(isLongPdfDocument(makeModel(29))).toBe(false);
    expect(isLongPdfDocument(makeModel(30))).toBe(true);
    expect(defaultTranslationMode(makeModel(76))).toBe('on-demand');
  });

  it('不足 30 页但可翻译字符达到十万也默认按需', () => {
    const model = makeModel(2, 'x'.repeat(50_000));
    expect(translatableCharacterCount(model)).toBe(100_000);
    expect(defaultTranslationMode(model)).toBe('on-demand');
  });

  it('不统计公式和无标题媒体正文', () => {
    const model = makeModel(1, '正文');
    model.pages[0].blocks.push(
      { id: 'formula', pageId: 'p1', order: 1, kind: 'formula', text: 'x'.repeat(100_000) },
      { id: 'figure', pageId: 'p1', order: 2, kind: 'figure', text: 'OCR'.repeat(100_000) },
    );
    expect(translatableCharacterCount(model)).toBe(2);
    expect(defaultTranslationMode(model)).toBe('full-document');
  });
});
