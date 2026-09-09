import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IndexedWebpageCache, cacheScope } from '../../../src/webpage/translation-cache';
import { openDB } from 'idb';

describe('网页缓存', () => {
  it('持久化、隔离页面、清理与到期', async () => {
    const cache = new IndexedWebpageCache();
    await cache.put('a', 'scope-a', '甲'); await cache.put('b', 'scope-b', '乙');
    expect(await new IndexedWebpageCache().get('a')).toBe('甲');
    await cache.clear('scope-a'); expect(await cache.get('a')).toBeUndefined(); expect(await cache.get('b')).toBe('乙');
    const now = Date.now(); const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 86400_000);
    try { expect(await cache.get('b')).toBeUndefined(); } finally { spy.mockRestore(); }
    expect(await cacheScope('https://example.com/a#one')).toBe(await cacheScope('https://example.com/a#two'));
    expect(await cacheScope('https://example.com/a')).not.toContain('example');
  });
  it('写入按条数与译文字节淘汰最旧记录', async () => {
    const cache = new IndexedWebpageCache();
    await cache.put('init', 'test', '初始化');
    const db = await openDB('webpage-translation-cache', 1);
    const tx = db.transaction('entries', 'readwrite');
    await tx.store.clear();
    const expires = Date.now() + 86400_000;
    for (let i = 0; i < 2000; i++) await tx.store.put({ key: `old-${i}`, scope: 'test', text: 'x', bytes: 1, accessed: i, expires });
    await tx.done;
    await cache.put('new', 'test', '新');
    expect(await db.count('entries')).toBe(2000); expect(await cache.get('old-0')).toBeUndefined();
    await cache.put('large', 'test', 'x'.repeat(8 * 1024 * 1024));
    expect(await db.count('entries')).toBe(1);
    expect((await cache.get('large'))?.length).toBe(8 * 1024 * 1024);
    await cache.clear('test'); db.close();
  });
});
