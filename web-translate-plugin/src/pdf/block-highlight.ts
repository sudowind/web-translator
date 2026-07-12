export interface HighlightRectPercent {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function mineruPolygonToPercentRect(values?: number[]): HighlightRectPercent | null {
  if (!values || (values.length !== 4 && values.length !== 8) ||
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) return null;

  const xs = values.length === 4 ? [values[0], values[2]] : values.filter((_, index) => index % 2 === 0);
  const ys = values.length === 4 ? [values[1], values[3]] : values.filter((_, index) => index % 2 === 1);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (x1 <= x0 || y1 <= y0) return null;

  return {
    left: x0 / 10,
    top: y0 / 10,
    width: (x1 - x0) / 10,
    height: (y1 - y0) / 10,
  };
}
