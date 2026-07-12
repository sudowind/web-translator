export interface VisiblePageCandidate {
  page: number;
  intersectionRatio: number;
}

export function selectDominantPage(
  candidates: readonly VisiblePageCandidate[],
  currentPage: number,
): number | null {
  const valid = candidates.filter((candidate) =>
    Number.isInteger(candidate.page) && candidate.page > 0 &&
    Number.isFinite(candidate.intersectionRatio) && candidate.intersectionRatio > 0);
  if (valid.length === 0) return null;
  const maximum = Math.max(...valid.map((candidate) => candidate.intersectionRatio));
  const dominant = valid.filter((candidate) => candidate.intersectionRatio === maximum);
  if (dominant.some((candidate) => candidate.page === currentPage)) return currentPage;
  return Math.min(...dominant.map((candidate) => candidate.page));
}
