export function initialPageFromUrl(sourceUrl: string, fallback = 1): number {
  try {
    const page = Number.parseInt(new URL(sourceUrl).hash.match(/(?:^|[&#])page=(\d+)(?:&|$)/i)?.[1] ?? '', 10);
    return Number.isInteger(page) && page > 0 ? page : fallback;
  } catch {
    return fallback;
  }
}
