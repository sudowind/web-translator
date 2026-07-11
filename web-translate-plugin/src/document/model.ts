export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'formula'
  | 'table'
  | 'figure'
  | 'caption'
  | 'footnote'
  | 'other';

export interface DocumentBlock {
  id: string;
  pageId: string;
  order: number;
  kind: BlockKind;
  text: string;
  latex?: string;
  html?: string;
  resourceUrl?: string;
  polygon?: number[];
}

export interface DocumentPage {
  id: string;
  index: number;
  blocks: DocumentBlock[];
}

export interface DocumentModel {
  id: string;
  sourceUrl: string;
  hash: string;
  title: string;
  pageCount: number;
  pages: DocumentPage[];
}

export interface DocumentMetadata {
  sourceUrl: string;
  hash: string;
  title: string;
  pageCount: number;
}
