import { describe, expect, it } from 'vitest';
import { historyEntryId, historyUrlWithPage, normalizeHistoryUrl, safeHistoryTitle } from '../../../src/history/model';

describe('翻译历史模型', () => {
  it('只接受 HTTP(S) 并移除 Fragment', () => {
    expect(normalizeHistoryUrl('https://example.test/a?q=1#section')).toBe('https://example.test/a?q=1');
    expect(() => normalizeHistoryUrl('chrome://extensions')).toThrow('HISTORY_URL_INVALID');
  });
  it('生成稳定记录 ID 并提供可读标题回退', () => {
    expect(historyEntryId('webpage', 'https://example.test/a')).toBe('webpage:https://example.test/a');
    expect(historyEntryId('pdf', 'https://example.test/p.pdf', 'hash-1')).toBe('pdf:hash-1');
    expect(safeHistoryTitle('', 'https://example.test/a')).toBe('example.test');
  });
  it('PDF 重新打开时恢复最近页且保留查询参数', () => {
    expect(historyUrlWithPage({
      id: 'pdf:h', kind: 'pdf', url: 'https://example.test/p.pdf?download=1#old', title: 'P',
      sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 1, lastPage: 7, pageCount: 10,
    })).toBe('https://example.test/p.pdf?download=1#page=7');
  });
});
