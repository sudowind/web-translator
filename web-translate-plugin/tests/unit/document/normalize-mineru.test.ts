import { describe, expect, it } from 'vitest';

import { DOCUMENT_SCHEMA_VERSION } from '../../../src/document/model';
import { normalizeMineru } from '../../../src/document/normalize-mineru';

const metadata = {
  sourceUrl: 'https://example.test/paper.pdf',
  hash: 'sha256:paper',
  title: 'A Paper',
  pageCount: 3,
};

describe('MinerU 文档规范化', () => {
  it('使用 text_level 区分正文与各级标题并保留原始层级', () => {
    const model = normalizeMineru([
      { page_idx: 0, type: 'text', text: 'Body', text_level: 0, bbox: [10, 20, 30, 40] },
      { page_idx: 0, type: 'text', text: 'Section', text_level: 1, bbox: [10, 50, 30, 70] },
      { page_idx: 0, type: 'text', text: 'Subsection', text_level: 3, bbox: [10, 80, 30, 100] },
      { page_idx: 0, type: 'title', text: 'Legacy title', bbox: [10, 110, 30, 130] },
    ], { ...metadata, pageCount: 1 });

    expect(model.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
    expect(model.pages[0].blocks).toMatchObject([
      { kind: 'paragraph', text: 'Body' },
      { kind: 'heading', text: 'Section', headingLevel: 1 },
      { kind: 'heading', text: 'Subsection', headingLevel: 3 },
      { kind: 'heading', text: 'Legacy title', headingLevel: 1 },
    ]);
  });

  it('去除独立公式的显示定界符但保留原始文本和公式编号', () => {
    const source = '$$\n\\operatorname{Attention}(Q,K,V)=QK^T\\tag{1}\n$$';
    const bracketed = '\\[ x^2 + y^2 \\]';
    const model = normalizeMineru([
      { page_idx: 0, type: 'equation', text: source },
      { page_idx: 0, type: 'equation', text: bracketed },
      { page_idx: 0, type: 'equation', text: 'E=mc^2' },
    ], { ...metadata, pageCount: 1 });

    expect(model.pages[0].blocks).toMatchObject([
      { kind: 'formula', text: source, latex: '\\operatorname{Attention}(Q,K,V)=QK^T\\tag{1}' },
      { kind: 'formula', text: bracketed, latex: 'x^2 + y^2' },
      { kind: 'formula', text: 'E=mc^2', latex: 'E=mc^2' },
    ]);
  });

  it('把 MinerU 表格与图片标题写入独立 caption 并忽略全空白标题', () => {
    const model = normalizeMineru([
      {
        page_idx: 0,
        type: 'table',
        text: 'table OCR must stay separate',
        table_body: '<table><tr><td>secret cell</td></tr></table>',
        table_caption: [' Table one ', 'continued'],
      },
      {
        page_idx: 0,
        type: 'image',
        text: 'image OCR must stay separate',
        img_path: 'images/figure.png',
        image_caption: [' Figure one '],
      },
      { page_idx: 0, type: 'table', table_caption: [' ', '\t'] },
      { page_idx: 0, type: 'image', img_path: 'images/no-title.png' },
    ], { ...metadata, pageCount: 1 });

    expect(model.schemaVersion).toBe(3);
    expect(model.pages[0].blocks).toMatchObject([
      { kind: 'table', text: 'table OCR must stay separate', caption: 'Table one\ncontinued' },
      { kind: 'figure', text: 'image OCR must stay separate', caption: 'Figure one' },
      { kind: 'table', text: '' },
      { kind: 'figure', text: '' },
    ]);
    expect(model.pages[0].blocks[2]).not.toHaveProperty('caption');
    expect(model.pages[0].blocks[3]).not.toHaveProperty('caption');
  });

  it.each([-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    '拒绝非法 text_level：%j',
    (text_level) => {
      expect(() => normalizeMineru(
        [{ page_idx: 0, type: 'text', text: 'secret heading', text_level }],
        { ...metadata, pageCount: 1 },
      )).toThrowError(expect.objectContaining({ code: 'MINERU_FIELD_INVALID' }));
    },
  );

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

  it.each([0, 601, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝不在 1..600 safe integer 范围内的 pageCount：%s',
    (pageCount) => {
      expect(() => normalizeMineru([], { ...metadata, pageCount })).toThrowError(
        expect.objectContaining({ code: 'MINERU_METADATA_INVALID' }),
      );
    },
  );

  it.each(['sourceUrl', 'hash', 'title'] as const)(
    '拒绝空白 metadata.%s 且不回显字段原文',
    (field) => {
      const secret = '  secret document body  ';
      try {
        normalizeMineru([], { ...metadata, [field]: '   ' });
        throw new Error('expected normalization to fail');
      } catch (error) {
        expect(error).toMatchObject({ code: 'MINERU_METADATA_INVALID' });
        expect(String(error)).not.toContain(secret.trim());
      }
    },
  );

  it('修剪 metadata 后再生成稳定 ID', () => {
    const model = normalizeMineru(
      [{ page_idx: 0, type: ' text ', text: 'Body' }],
      {
        sourceUrl: ' https://example.test/paper.pdf ',
        hash: ' sha256:trimmed ',
        title: ' Paper ',
        pageCount: 1,
      },
    );
    expect(model).toMatchObject({
      id: 'sha256:trimmed',
      sourceUrl: 'https://example.test/paper.pdf',
      hash: 'sha256:trimmed',
      title: 'Paper',
    });
    expect(model.pages[0].id).toBe('sha256:trimmed:p1');
    expect(model.pages[0].blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('拒绝空白 raw block type', () => {
    expect(() => normalizeMineru(
      [{ page_idx: 0, type: '   ', text: 'secret raw body' }],
      { ...metadata, pageCount: 1 },
    )).toThrowError(expect.objectContaining({ code: 'MINERU_FIELD_INVALID' }));
  });

  it('允许空 text 搭配 caption 与表格 HTML 并原样保留可选字符串', () => {
    const model = normalizeMineru([
      {
        page_idx: 0,
        type: 'table',
        text: '',
        table_caption: ['Table caption'],
        table_body: '  <table><tr><td>x</td></tr></table>  ',
      },
      {
        page_idx: 0,
        type: 'image',
        text: '  Figure body  ',
        img_path: '  images/figure.png  ',
      },
      {
        page_idx: 0,
        type: 'image',
        text: '   ',
        img_path: '',
      },
    ], { ...metadata, pageCount: 1 });

    expect(model.pages[0].blocks).toMatchObject([
      {
        kind: 'table',
        text: '',
        html: '  <table><tr><td>x</td></tr></table>  ',
      },
      {
        kind: 'figure',
        text: '  Figure body  ',
        resourceUrl: '  images/figure.png  ',
      },
      {
        kind: 'figure',
        text: '   ',
        resourceUrl: '',
      },
    ]);
  });
});
