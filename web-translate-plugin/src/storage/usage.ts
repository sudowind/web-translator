/** 浏览器对当前扩展来源存储的估算，不扫描或复制数据库内容。 */
export async function getStorageUsage(): Promise<number | undefined> {
  try {
    const usage = (await globalThis.navigator?.storage?.estimate())?.usage;
    return typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 ? usage : undefined;
  } catch {
    return undefined;
  }
}

export function formatStorageUsage(bytes: number | undefined): string {
  if (bytes === undefined) return '暂不可用';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  const unit = Math.max(0, index);
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
