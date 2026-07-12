export interface PageScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export type PageWheelAction = 'inner' | 'previous' | 'next';

export function pageWheelAction(metrics: PageScrollMetrics, deltaY: number): PageWheelAction {
  if (deltaY < 0 && metrics.scrollTop <= 1) return 'previous';
  if (deltaY > 0 && metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1) return 'next';
  return 'inner';
}
