import type { DocumentModel } from '../document/model';
import { translationBlocksForPage } from './translate-page';
import type { TranslationMode } from './page-scheduler';

export const LONG_PDF_PAGE_THRESHOLD = 30;
export const LONG_PDF_CHARACTER_THRESHOLD = 100_000;

export function translatableCharacterCount(model: DocumentModel): number {
  return model.pages.reduce((total, page) => total + translationBlocksForPage(page)
    .reduce((pageTotal, block) => pageTotal + block.text.length, 0), 0);
}

export function isLongPdfDocument(model: DocumentModel): boolean {
  return model.pageCount >= LONG_PDF_PAGE_THRESHOLD ||
    translatableCharacterCount(model) >= LONG_PDF_CHARACTER_THRESHOLD;
}

export function defaultTranslationMode(model: DocumentModel): TranslationMode {
  return isLongPdfDocument(model) ? 'on-demand' : 'full-document';
}
