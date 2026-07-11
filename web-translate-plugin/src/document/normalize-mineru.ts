import { blockId, pageId } from './ids';
import type {
  BlockKind,
  DocumentMetadata,
  DocumentModel,
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
  validateMetadata(metadata);
  if (!Array.isArray(input)) throw new MineruDataError('MINERU_INPUT_NOT_ARRAY');

  const pages = Array.from({ length: metadata.pageCount }, (_, index) => ({
    id: pageId(metadata.hash, index),
    index,
    blocks: [] as DocumentModel['pages'][number]['blocks'],
  }));

  for (const value of input) {
    if (!isRecord(value)) throw new MineruDataError('MINERU_BLOCK_NOT_OBJECT');
    const pageIndex = value.page_idx;
    if (!Number.isInteger(pageIndex)) {
      throw new MineruDataError('MINERU_PAGE_INVALID');
    }
    if ((pageIndex as number) < 0 || (pageIndex as number) >= metadata.pageCount) {
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
    const kind = kinds[type] ?? 'other';
    const page = pages[pageIndex as number];
    const order = page.blocks.length;
    const caption = imageCaption ?? tableCaption;
    const normalizedText = text ?? caption?.join('\n') ?? '';

    page.blocks.push({
      id: blockId(metadata.hash, pageIndex as number, order),
      pageId: page.id,
      order,
      kind,
      text: normalizedText,
      ...(kind === 'formula' ? { latex: normalizedText } : {}),
      ...(html === undefined ? {} : { html }),
      ...(imagePath === undefined ? {} : { resourceUrl: imagePath }),
      ...((polygon ?? bbox) === undefined ? {} : { polygon: polygon ?? bbox }),
    });
  }

  return { id: metadata.hash, ...metadata, pages };
}

function validateMetadata(metadata: DocumentMetadata): void {
  if (
    !isRecord(metadata) ||
    typeof metadata.sourceUrl !== 'string' ||
    typeof metadata.hash !== 'string' ||
    typeof metadata.title !== 'string' ||
    !Number.isInteger(metadata.pageCount) ||
    metadata.pageCount < 0
  ) {
    throw new MineruDataError('MINERU_METADATA_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new MineruDataError('MINERU_FIELD_INVALID');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
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
