import { describe, expect, it } from 'vitest';

import { initialLifecycleState, lifecycleReducer } from '../../../src/pdf/workspace-reducer';

describe('PDF 工作台生命周期', () => {
  it('认证 PDF 必须明确同意后才进入上传', () => {
    const loaded = lifecycleReducer(initialLifecycleState, { type: 'source-loaded', sourceKind: 'authenticated' });
    expect(loaded).toMatchObject({ phase: 'awaiting-consent', pdfReady: true });
    expect(lifecycleReducer(loaded, { type: 'consent-granted' }).phase).toBe('uploading');
  });

  it('公共 PDF 先进入解析且解析失败不破坏左栏', () => {
    const loaded = lifecycleReducer(initialLifecycleState, { type: 'source-loaded', sourceKind: 'remote' });
    expect(loaded.phase).toBe('parsing');
    expect(lifecycleReducer(loaded, { type: 'parse-failed', error: 'MINERU_TIMEOUT' })).toMatchObject({ phase: 'failed', pdfReady: true, error: 'MINERU_TIMEOUT' });
  });

  it('覆盖 loading、翻译、ready、取消与缓存清理', () => {
    const loading = lifecycleReducer(initialLifecycleState, { type: 'load-started' });
    const translating = lifecycleReducer({ ...loading, pdfReady: true }, { type: 'parse-done' });
    expect(translating.phase).toBe('translating');
    expect(lifecycleReducer(translating, { type: 'translations-done' }).phase).toBe('ready');
    expect(lifecycleReducer(translating, { type: 'cancelled' }).phase).toBe('idle');
    expect(lifecycleReducer(translating, { type: 'cache-cleared' })).toEqual(initialLifecycleState);
  });
});
