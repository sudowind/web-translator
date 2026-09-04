import { blockId, pageId } from './ids';
import {
  DOCUMENT_SCHEMA_VERSION,
  type BlockKind,
  type DocumentBlock,
  type DocumentMetadata,
  type DocumentModel,
  type DocumentPage,
} from './model';

export class MineruDataError extends Error {
  override readonly name = 'MineruDataError';

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
  page_footnote: 'footnote',
};

const pageAuxiliaryTypes = new Set([
  'header',
  'page_header',
  'footer',
  'page_footer',
  'page_number',
  'aside_text',
  'page_aside_text',
]);

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
    if (pageAuxiliaryTypes.has(type.toLowerCase())) continue;
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
    const caption = normalizeCaption(imageCaption ?? tableCaption);
    const normalizedText = text ?? caption ?? '';
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
      ...(caption === undefined ? {} : { caption }),
      ...(headingLevel === undefined ? {} : { headingLevel }),
      ...(latex === undefined ? {} : { latex }),
      ...(html === undefined ? {} : { html }),
      ...(imagePath === undefined ? {} : { resourceUrl: imagePath }),
      ...((polygon ?? bbox) === undefined ? {} : { polygon: polygon ?? bbox }),
    });
  }

  removeRepeatedPageDecorations(pages, normalizedMetadata.hash);

  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: normalizedMetadata.hash,
    ...normalizedMetadata,
    pages,
  };
}

function removeRepeatedPageDecorations(pages: DocumentPage[], hash: string): void {
  const occurrences = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const block of page.blocks) {
      const signature = decorationSignature(block);
      if (!signature) continue;
      const pageIndexes = occurrences.get(signature) ?? new Set<number>();
      pageIndexes.add(page.index);
      occurrences.set(signature, pageIndexes);
    }
  }

  const repeatedThreshold = Math.max(3, Math.ceil(pages.length / 2));
  const repeated = new Set(
    [...occurrences.entries()]
      .filter(([, pageIndexes]) => pageIndexes.size >= repeatedThreshold)
      .map(([signature]) => signature),
  );

  for (const page of pages) {
    const retained = page.blocks.filter((block) => {
      const signature = decorationSignature(block);
      return !signature || !repeated.has(signature);
    });
    page.blocks = retained.map((block, order) => ({
      ...block,
      id: blockId(hash, page.index, order),
      order,
    }));
  }
}

function decorationSignature(block: DocumentBlock): string | undefined {
  if (block.kind !== 'paragraph' && block.kind !== 'heading' && block.kind !== 'other') {
    return undefined;
  }
  const bounds = verticalBounds(block.polygon);
  if (!bounds) return undefined;
  const zone = bounds.bottom <= 140
    ? 'top'
    : bounds.top >= 860
      ? 'bottom'
      : undefined;
  if (!zone) return undefined;

  const text = normalizeDecorationText(block.text);
  if (!text || text.length > 160) return undefined;
  const horizontalCenter = Math.round(bounds.horizontalCenter / 50);
  const verticalCenter = Math.round(((bounds.top + bounds.bottom) / 2) / 25);
  return `${zone}:${horizontalCenter}:${verticalCenter}:${text}`;
}

function normalizeDecorationText(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '<number>')
    .replace(/\s+/g, ' ');
}

function verticalBounds(polygon: number[] | undefined): {
  top: number;
  bottom: number;
  horizontalCenter: number;
} | undefined {
  if (!polygon || (polygon.length !== 4 && (polygon.length < 8 || polygon.length % 2 !== 0))) {
    return undefined;
  }
  if (polygon.some((coordinate) => coordinate < 0 || coordinate > 1_000)) {
    return undefined;
  }
  if (polygon.length === 4) {
    const [left, top, right, bottom] = polygon;
    if (right < left || bottom < top) return undefined;
    return { top, bottom, horizontalCenter: (left + right) / 2 };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < polygon.length; index += 2) {
    xs.push(polygon[index]);
    ys.push(polygon[index + 1]);
  }
  return {
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    horizontalCenter: (Math.min(...xs) + Math.max(...xs)) / 2,
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

function normalizeCaption(value: string[] | undefined): string | undefined {
  const caption = value
    ?.map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
  return caption || undefined;
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new MineruDataError('MINERU_FIELD_INVALID');
  }
  return value;
}
