export interface TimingSample { ttftMs?: number; durationMs: number }
export function summarizeTiming(samples: TimingSample[]): string {
  const summary = (values: number[]) => {
    if (!values.length) return '暂无样本';
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return `中位 ${(median / 1000).toFixed(2)}s / P95 ${(sorted[Math.ceil(sorted.length * .95) - 1] / 1000).toFixed(2)}s（${sorted.length} 次）`;
  };
  return `TTFT ${summary(samples.flatMap(s => s.ttftMs === undefined ? [] : [s.ttftMs]))}；请求 ${summary(samples.map(s => s.durationMs))}`;
}
