export function initialPageFromUrl(sourceUrl: string): number {
  try {
    const page = Number.parseInt(new URL(sourceUrl).hash.match(/(?:^|[&#])page=(\d+)(?:&|$)/i)?.[1] ?? '', 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}
