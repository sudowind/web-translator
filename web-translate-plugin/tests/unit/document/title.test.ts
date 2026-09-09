import { expect, it } from 'vitest';
import { normalizeMineru } from '../../../src/document/normalize-mineru';
import { withPaperTitle } from '../../../src/document/title';

const metadata = { title: '2510.12403v1.pdf', sourceUrl: 'https://arxiv.org/pdf/2510.12403v1', hash: 'paper', pageCount: 2 };
it('首页标题合并换行，解析和旧缓存使用同一标题', () => {
  const model = normalizeMineru([
    { type: 'header', page_idx: 0, text: 'arXiv preprint' },
    { type: 'text', text_level: 1, page_idx: 0, text: 'Learning Robot Policies\nfrom Demonstrations' },
    { type: 'text', page_idx: 0, text: 'Authors' },
    { type: 'title', page_idx: 1, text: 'Other page heading' },
  ], metadata);
  expect(model.title).toBe('Learning Robot Policies from Demonstrations');
  expect(withPaperTitle({ ...model, title: metadata.title }).title).toBe(model.title);
});
it('缺失标题、正文后章节、摘要和编号章节均回退文件名', () => {
  for (const blocks of [[], [{type: 'text', text: 'Authors'}, {type: 'title', text: 'Methods'}],
    ...['Abstract', 'Introduction', '1 Introduction', '目录'].map(text => [{type: 'title', text}])]) {
    expect(normalizeMineru(blocks.map(block => ({...block, page_idx: 0})), metadata).title).toBe(metadata.title);
  }
});
