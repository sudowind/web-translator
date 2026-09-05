import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Dashboard, { filterHistoryEntries } from '../../../entrypoints/options/Dashboard';

const entries = [
  { id: 'pdf:1', kind: 'pdf' as const, url: 'https://papers.test/one.pdf', title: 'Attention Paper', sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 2 },
  { id: 'webpage:2', kind: 'webpage' as const, url: 'https://news.test/story', title: 'Browser Story', sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 1 },
];

describe('扩展阅读控制台', () => {
  it('呈现五个产品分区和本地隐私说明', () => {
    const html = renderToStaticMarkup(<Dashboard initialSection="history" />);
    expect(html).toContain('最近阅读');
    expect(html).toContain('AI 服务');
    expect(html).toContain('翻译偏好');
    expect(html).toContain('PDF 解析');
    expect(html).toContain('存储与隐私');
    expect(html).toContain('数据只保存在此浏览器');
  });

  it('按类型、标题和 URL 筛选历史', () => {
    expect(filterHistoryEntries(entries, 'attention', 'all')).toEqual([entries[0]]);
    expect(filterHistoryEntries(entries, 'news.test', 'webpage')).toEqual([entries[1]]);
    expect(filterHistoryEntries(entries, '', 'pdf')).toEqual([entries[0]]);
  });
});
