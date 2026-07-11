import { describe, expect, it } from 'vitest';

import { normalizeMineru } from '../../../src/document/normalize-mineru';

const metadata = {
  sourceUrl: 'https://example.test/paper.pdf',
  hash: 'sha256:paper',
  title: 'A Paper',
  pageCount: 3,
};

describe('MinerU 文档规范化', () => {
  it('保留空白页、页内顺序、公式、表格、图片与坐标', () => {
    const model = normalizeMineru([
      { page_idx: 0, type: 'title', text: 'A Paper', bbox: [1, 2, 3, 4] },
      { page_idx: 0, type: 'equation', text: 'E=mc^2' },
      {
        page_idx: 2,
        type: 'table',
        table_body: '<table><tr><td>x</td></tr></table>',
        table_caption: ['Table one'],
      },
      {
        page_idx: 2,
        type: 'image',
        img_path: 'images/figure.png',
        image_caption: ['Figure one', 'continued'],
        polygon: [0, 0, 10, 0, 10, 10, 0, 10],
      },
    ], metadata);

    expect(model.pages).toHaveLength(3);
    expect(model.pages[1].blocks).toEqual([]);
    expect(model.pages[0].blocks).toMatchObject([
      { kind: 'heading', text: 'A Paper', polygon: [1, 2, 3, 4] },
      { kind: 'formula', text: 'E=mc^2', latex: 'E=mc^2' },
    ]);
    expect(model.pages[2].blocks).toMatchObject([
      { kind: 'table', text: 'Table one', html: '<table><tr><td>x</td></tr></table>' },
      {
        kind: 'figure',
        text: 'Figure one\ncontinued',
        resourceUrl: 'images/figure.png',
        polygon: [0, 0, 10, 0, 10, 10, 0, 10],
      },
    ]);
    expect(model.pages[0].id).toBe('sha256:paper:p1');
    expect(model.pages[2].blocks[1].id).toBe('sha256:paper:p3:b2');
  });

  it.each([
    ['输入不是数组', { blocks: [] }, 'MINERU_INPUT_NOT_ARRAY'],
    ['条目不是对象', [null], 'MINERU_BLOCK_NOT_OBJECT'],
    ['page_idx 不是整数', [{ page_idx: 0.5, type: 'text', text: 'secret body' }], 'MINERU_PAGE_INVALID'],
    ['页码越界', [{ page_idx: 3, type: 'text', text: 'secret body' }], 'MINERU_PAGE_OUT_OF_RANGE'],
    ['字符串字段类型错误', [{ page_idx: 0, type: 'text', text: { raw: 'secret body' } }], 'MINERU_FIELD_INVALID'],
    ['数组字段类型错误', [{ page_idx: 0, type: 'image', image_caption: ['ok', 3] }], 'MINERU_FIELD_INVALID'],
  ])('%s 时返回不泄露原文的结构化错误', (_name, input, code) => {
    try {
      normalizeMineru(input, metadata);
      throw new Error('expected normalization to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'MineruDataError', code });
      expect(String(error)).not.toContain('secret body');
    }
  });

  it('拒绝无效 metadata 且不回显值', () => {
    expect(() => normalizeMineru([], { ...metadata, pageCount: -1 })).toThrowError(
      expect.objectContaining({ code: 'MINERU_METADATA_INVALID' }),
    );
  });
});
