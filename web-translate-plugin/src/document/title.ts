import type { DocumentModel } from './model';

export function isFallbackTitle(title: string): boolean {
  return !title.trim() || /\.pdf(?:[?#].*)?$/i.test(title.trim()) ||
    /^(?:https?:\/\/|arxiv:|\d{4}\.\d{4,5}(?:v\d+)?$)/i.test(title.trim()) ||
    /^(?:untitled|document|PDF 翻译工作台)$/i.test(title.trim());
}

export function parsedPaperTitle(model: DocumentModel): string | undefined {
  const firstPage = model.pages.find(page => page.index === 0);
  for (const block of firstPage?.blocks.slice(0, 8) ?? []) {
    const text = block.text.replace(/\s+/g, ' ').trim();
    if (!text || block.kind === 'figure' || block.kind === 'footnote' || /^arxiv[:\s]/i.test(text)) continue;
    // A section heading after prose is not evidence of a document title.
    if (block.kind !== 'heading' || (block.headingLevel !== undefined && block.headingLevel !== 1)) return;
    if (text.length < 4 || text.length > 300 || isFallbackTitle(text) ||
      /^(?:(?:\d+(?:\.\d+)*[.\s])|abstract\b|introduction\b|contents\b|table of contents\b|references\b|摘要|引言|目录|参考文献)/i.test(text)) return;
    return text;
  }
}

export function withPaperTitle(model: DocumentModel): DocumentModel {
  const title = parsedPaperTitle(model);
  return title && title !== model.title ? { ...model, title } : model;
}
