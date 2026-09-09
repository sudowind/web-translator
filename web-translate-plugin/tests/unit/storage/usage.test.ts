import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatStorageUsage, getStorageUsage } from '../../../src/storage/usage';

afterEach(() => vi.unstubAllGlobals());
describe('storage usage estimate', () => {
  it.each([0, 1024, 2097152])('returns browser usage %s', async (usage) => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage }) } });
    expect(await getStorageUsage()).toBe(usage);
  });
  it.each([undefined, -1, NaN, Infinity])('rejects missing or invalid usage %s', async (usage) => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage }) } });
    expect(await getStorageUsage()).toBeUndefined();
  });
  it('handles unavailable or failed browser estimates', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getStorageUsage()).toBeUndefined();
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('unavailable'); } } });
    expect(await getStorageUsage()).toBeUndefined();
  });
  it('distinguishes unavailable from zero and formats binary units', () => {
    expect(formatStorageUsage(undefined)).toBe('暂不可用');
    expect(formatStorageUsage(0)).toBe('0 B');
    expect(formatStorageUsage(1536)).toBe('1.5 KiB');
    expect(formatStorageUsage(2097152)).toBe('2.0 MiB');
  });
});
