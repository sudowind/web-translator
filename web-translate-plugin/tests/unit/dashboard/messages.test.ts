import { describe, expect, it, vi } from 'vitest';
import { dispatchDashboardMessage, isDashboardMessage, isOptionsPageSender } from '../../../src/dashboard/messages';

const entries = [{
  id: 'pdf:h1', kind: 'pdf' as const, url: 'https://example.test/p.pdf', title: 'Paper',
  sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: 1, lastPage: 4, pageCount: 10,
}];
const dependencies = () => ({
  listHistory: vi.fn().mockResolvedValue(entries), getHistory: vi.fn().mockResolvedValue(entries[0]),
  deleteHistory: vi.fn().mockResolvedValue(undefined), clearHistory: vi.fn().mockResolvedValue(undefined),
  clearCache: vi.fn().mockResolvedValue(undefined),
  getSummary: vi.fn().mockResolvedValue({ documents: 1, translations: 4, tasks: 1, history: 1 }),
  openUrl: vi.fn().mockResolvedValue(undefined),
});

describe('控制台消息', () => {
  it('只接受精确消息结构', () => {
    expect(isDashboardMessage({ type: 'dashboard:get-state' })).toBe(true);
    expect(isDashboardMessage({ type: 'dashboard:delete-history', id: 'pdf:h1' })).toBe(true);
    expect(isDashboardMessage({ type: 'dashboard:open-history', id: 'pdf:h1', extra: true })).toBe(false);
  });
  it('允许 options 页面带查询或 Fragment，拒绝其他扩展页', () => {
    const url = 'chrome-extension://extension-id/options.html';
    expect(isOptionsPageSender({ id: 'extension-id', url: `${url}?section=history#pdf` }, url)).toBe(true);
    expect(isOptionsPageSender({ id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' }, url)).toBe(false);
  });
  it('读取、删除、清理与重新打开均由受信 options 页面调度', async () => {
    const deps = dependencies();
    const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/options.html#history' };
    const url = 'chrome-extension://extension-id/options.html';
    await expect(dispatchDashboardMessage({ type: 'dashboard:get-state' }, sender, url, deps))
      .resolves.toMatchObject({ ok: true, value: { entries, summary: { history: 1 } } });
    await dispatchDashboardMessage({ type: 'dashboard:delete-history', id: 'pdf:h1' }, sender, url, deps);
    await dispatchDashboardMessage({ type: 'dashboard:clear-history' }, sender, url, deps);
    await dispatchDashboardMessage({ type: 'dashboard:clear-cache' }, sender, url, deps);
    await dispatchDashboardMessage({ type: 'dashboard:open-history', id: 'pdf:h1' }, sender, url, deps);
    expect(deps.deleteHistory).toHaveBeenCalledWith('pdf:h1');
    expect(deps.clearHistory).toHaveBeenCalledOnce();
    expect(deps.clearCache).toHaveBeenCalledOnce();
    expect(deps.openUrl).toHaveBeenCalledWith('https://example.test/p.pdf#page=4');
  });
  it('拒绝非 options 页面和不存在的历史记录', async () => {
    const deps = dependencies();
    deps.getHistory.mockResolvedValueOnce(undefined);
    await expect(dispatchDashboardMessage({ type: 'dashboard:get-state' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' },
      'chrome-extension://extension-id/options.html', deps,
    )).resolves.toEqual({ ok: false, error: 'DASHBOARD_SENDER_INVALID' });
    await expect(dispatchDashboardMessage({ type: 'dashboard:open-history', id: 'missing' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' },
      'chrome-extension://extension-id/options.html', deps,
    )).resolves.toEqual({ ok: false, error: 'HISTORY_ENTRY_NOT_FOUND' });
  });
});
