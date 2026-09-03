export type ReadingLayoutMode = 'paired' | 'stacked';

export const MIN_TRANSLATION_WIDTH = 480;
export const MIN_PAIRED_READING_WIDTH = 900;
export const MAX_TRANSLATION_WIDTH = 720;
export const LAYOUT_HYSTERESIS = 48;
export const MAX_CANVAS_PIXELS = 8_388_608;
export const MAX_OUTPUT_SCALE = 2;

export interface ReadingLayout {
  mode: ReadingLayoutMode;
  containerWidth: number;
  pdfWidth: number;
  translationWidth: number;
  gutter: number;
  pairWidth: number;
  requiredPairedWidth: number;
  fittedToContainer: boolean;
}

interface ReadingLayoutInput {
  containerWidth: number;
  pageWidth: number;
  requestedScale: number;
  previousMode?: ReadingLayoutMode;
}

interface LayoutCandidate {
  mode: ReadingLayoutMode;
  requiredPairedWidth: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function applyLayoutHysteresis(
  previousMode: ReadingLayoutMode | undefined,
  candidate: LayoutCandidate,
  containerWidth: number,
): ReadingLayoutMode {
  if (candidate.mode === 'stacked' || previousMode !== 'stacked') return candidate.mode;
  return containerWidth >= candidate.requiredPairedWidth + LAYOUT_HYSTERESIS ? 'paired' : 'stacked';
}

export function computeReadingLayout({
  containerWidth,
  pageWidth,
  requestedScale,
  previousMode,
}: ReadingLayoutInput): ReadingLayout {
  const availableWidth = Math.max(0, containerWidth);
  const requestedPdfWidth = Math.max(0, pageWidth * requestedScale);
  const gutter = clamp(availableWidth * 0.008, 12, 20);
  const requiredPairedWidth = requestedPdfWidth + gutter + MIN_TRANSLATION_WIDTH;
  const candidateMode: ReadingLayoutMode = availableWidth >= MIN_PAIRED_READING_WIDTH
    && requiredPairedWidth <= availableWidth
    ? 'paired'
    : 'stacked';
  const mode = applyLayoutHysteresis(previousMode, { mode: candidateMode, requiredPairedWidth }, availableWidth);

  if (mode === 'paired') {
    const idealTranslationWidth = clamp(availableWidth * 0.34, 520, MAX_TRANSLATION_WIDTH);
    const translationWidth = Math.min(idealTranslationWidth, availableWidth - requestedPdfWidth - gutter);
    const pairWidth = requestedPdfWidth + gutter + translationWidth;
    return {
      mode,
      containerWidth: availableWidth,
      pdfWidth: requestedPdfWidth,
      translationWidth,
      gutter,
      pairWidth,
      requiredPairedWidth,
      fittedToContainer: false,
    };
  }

  const pdfWidth = Math.min(requestedPdfWidth, availableWidth);
  const translationWidth = Math.min(MAX_TRANSLATION_WIDTH, availableWidth);
  return {
    mode,
    containerWidth: availableWidth,
    pdfWidth,
    translationWidth,
    gutter,
    pairWidth: Math.max(pdfWidth, translationWidth),
    requiredPairedWidth,
    fittedToContainer: requestedPdfWidth > availableWidth,
  };
}

export interface PageDisplayMetrics {
  cssWidth: number;
  cssHeight: number;
  displayScale: number;
  outputScale: number;
  bitmapWidth: number;
  bitmapHeight: number;
  fittedToContainer: boolean;
}

interface PageDisplayMetricsInput {
  baseWidth: number;
  baseHeight: number;
  requestedScale: number;
  allocatedWidth: number;
  devicePixelRatio: number;
  pixelBudget?: number;
  maximumOutputScale?: number;
}

export function computePageDisplayMetrics({
  baseWidth,
  baseHeight,
  requestedScale,
  allocatedWidth,
  devicePixelRatio,
  pixelBudget = MAX_CANVAS_PIXELS,
  maximumOutputScale = MAX_OUTPUT_SCALE,
}: PageDisplayMetricsInput): PageDisplayMetrics {
  if (baseWidth <= 0 || baseHeight <= 0 || requestedScale <= 0 || allocatedWidth <= 0) {
    return {
      cssWidth: 0,
      cssHeight: 0,
      displayScale: 0,
      outputScale: 1,
      bitmapWidth: 0,
      bitmapHeight: 0,
      fittedToContainer: false,
    };
  }

  const requestedWidth = baseWidth * requestedScale;
  const cssWidth = Math.min(requestedWidth, allocatedWidth);
  const displayScale = cssWidth / baseWidth;
  const cssHeight = baseHeight * displayScale;
  const budgetScale = Math.sqrt(pixelBudget / (cssWidth * cssHeight));
  const outputScale = clamp(Math.min(devicePixelRatio || 1, budgetScale), 1, maximumOutputScale);

  return {
    cssWidth,
    cssHeight,
    displayScale,
    outputScale,
    bitmapWidth: Math.ceil(cssWidth * outputScale),
    bitmapHeight: Math.ceil(cssHeight * outputScale),
    fittedToContainer: cssWidth < requestedWidth - 0.5,
  };
}

export function shouldRerenderPage(
  previous: PageDisplayMetrics | undefined,
  next: PageDisplayMetrics,
): boolean {
  if (!previous) return true;
  return Math.abs(previous.cssWidth - next.cssWidth) >= 0.5
    || Math.abs(previous.cssHeight - next.cssHeight) >= 0.5
    || Math.abs(previous.outputScale - next.outputScale) >= 0.05;
}
