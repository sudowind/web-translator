export const pageId = (hash: string, index: number): string =>
  `${hash}:p${index + 1}`;

export const blockId = (hash: string, page: number, order: number): string =>
  `${hash}:p${page + 1}:b${order + 1}`;
