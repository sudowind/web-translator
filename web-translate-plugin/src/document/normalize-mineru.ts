import { blockId, pageId } from './ids';
import {
  DOCUMENT_SCHEMA_VERSION,
  type BlockKind,
  type DocumentMetadata,
  type DocumentModel,
} from './model';

export class MineruDataError extends Error {
  readonly name = 'MineruDataError';

  constructor(readonly code: string) {
    super(code);
  }
}

const kinds: Record<string, BlockKind> = {
  title: 'heading',
  text: 'paragraph',
  list: 'list',
  equation: 'formula',
  interline_equation: 'formula',
  table: 'table',
  image: 'figure',
  image_caption: 'caption',
  table_caption: 'caption',
  footnote: 'footnote',
};

export function normalizeMineru(
  input: unknown,
  metadata: DocumentMetadata,
): DocumentModel {
  const normalizedMetadata = normalizeMetadata(metadata);
  if (!Array.isArray(input)) throw new MineruDataError('MINERU_INPUT_NOT_ARRAY');

  const pages = Array.from({ length: normalizedMetadata.pageCount }, (_, index) => ({
    id: pageId(normalizedMetadata.hash, index),
    index,
    blocks: [] as DocumentModel['pages'][number]['blocks'],
  }));

  for (const value of input) {
    if (!isRecord(value)) throw new MineruDataError('MINERU_BLOCK_NOT_OBJECT');
    const pageIndex = value.page_idx;
    if (!Number.isInteger(pageIndex)) {
      throw new MineruDataError('MINERU_PAGE_INVALID');
    }
    if ((pageIndex as number) < 0 || (pageIndex as number) >= normalizedMetadata.pageCount) {
      throw new MineruDataError('MINERU_PAGE_OUT_OF_RANGE');
    }
    const type = requiredString(value.type);
    const text = optionalString(value.text);
    const imagePath = optionalString(value.img_path);
    const html = optionalString(value.table_body);
    const imageCaption = optionalStringArray(value.image_caption);
    const tableCaption = optionalStringArray(value.table_caption);
    const bbox = optionalNumberArray(value.bbox);
    const polygon = optionalNumberArray(value.polygon);
    const textLevel = optionalTextLevel(value.text_level);
    const baseKind = kinds[type] ?? 'other';
    const kind: BlockKind = type === 'text' && (textLevel ?? 0) > 0
      ? 'heading'
      : baseKind;
    const page = pages[pageIndex as number];
    const order = page.blocks.length;
    const caption = imageCaption ?? tableCaption;
    const normalizedText = text ?? caption?.join('\n') ?? '';
    const headingLevel = kind === 'heading'
      ? (type === 'title' ? 1 : textLevel)
      : undefined;
    const latex = kind === 'formula'
      ? normalizeFormulaLatex(normalizedText)
      : undefined;

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
  }

  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: normalizedMetadata.hash,
    ...normalizedMetadata,
    pages,
  };
}

function normalizeMetadata(metadata: DocumentMetadata): DocumentMetadata {
  if (
    !isRecord(metadata) ||
    typeof metadata.sourceUrl !== 'string' ||
    typeof metadata.hash !== 'string' ||
    typeof metadata.title !== 'string' ||
    !Number.isSafeInteger(metadata.pageCount) ||
    metadata.pageCount < 1 ||
    metadata.pageCount > 600
  ) {
    throw new MineruDataError('MINERU_METADATA_INVALID');
  }
  const sourceUrl = metadata.sourceUrl.trim();
  const hash = metadata.hash.trim();
  const title = metadata.title.trim();
  if (!sourceUrl || !hash || !title) {
    throw new MineruDataError('MINERU_METADATA_INVALID');
  }
  return { sourceUrl, hash, title, pageCount: metadata.pageCount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new MineruDataError('MINERU_FIELD_INVALID');
  const normalized = value.trim();
  if (!normalized) throw new MineruDataError('MINERU_FIELD_INVALID');
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new MineruDataError('MINERU_FIELD_INVALID');
  return value;
}

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

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new MineruDataError('MINERU_FIELD_INVALID');
  }
  return value;
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new MineruDataError('MINERU_FIELD_INVALID');
  }
  return value;
}
