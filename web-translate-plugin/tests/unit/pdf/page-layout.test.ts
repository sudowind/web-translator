import { describe, expect, it } from 'vitest';

import {
  MAX_CANVAS_PIXELS,
  applyLayoutHysteresis,
  computePageDisplayMetrics,
  computeReadingLayout,
  shouldRerenderPage,
} from '../../../src/pdf/page-layout';

describe('PDF 紧凑对译布局', () => {
  it.each([
    { containerWidth: 2528, scale: 1.8 },
    { containerWidth: 2140, scale: 1.8 },
    { containerWidth: 1408, scale: 1.1 },
    { containerWidth: 1000, scale: 0.5 },
  ])('在 $containerWidth px、$scale 倍缩放下保持紧凑中缝和译文行长', ({ containerWidth, scale }) => {
    const layout = computeReadingLayout({
      containerWidth,
      pageWidth: 612,
      requestedScale: scale,
    });

    expect(layout.mode).toBe('paired');
    expect(layout.gutter).toBeGreaterThanOrEqual(12);
    expect(layout.gutter).toBeLessThanOrEqual(20);
    expect(layout.translationWidth).toBeGreaterThanOrEqual(480);
    expect(layout.translationWidth).toBeLessThanOrEqual(720);
    expect(layout.pairWidth).toBeCloseTo(layout.pdfWidth + layout.gutter + layout.translationWidth, 5);
    expect(layout.pairWidth).toBeLessThanOrEqual(containerWidth);
  });

  it('在智能体压缩阅读区或高倍缩放后切换上下布局', () => {
    expect(computeReadingLayout({ containerWidth: 1048, pageWidth: 612, requestedScale: 1.1 }).mode).toBe('stacked');
    expect(computeReadingLayout({ containerWidth: 2120, pageWidth: 612, requestedScale: 3 }).mode).toBe('stacked');
    expect(computeReadingLayout({ containerWidth: 800, pageWidth: 612, requestedScale: 0.5 }).mode).toBe('stacked');
  });

  it('上下布局限制页面和译文宽度且不产生水平溢出', () => {
    const layout = computeReadingLayout({ containerWidth: 800, pageWidth: 612, requestedScale: 1.8 });
    expect(layout).toMatchObject({ mode: 'stacked', pdfWidth: 800, translationWidth: 720, pairWidth: 800 });
    expect(layout.fittedToContainer).toBe(true);
  });

  it('从上下布局恢复双列时保留 48px 滞回区', () => {
    const candidate = { mode: 'paired' as const, requiredPairedWidth: 1200 };
    expect(applyLayoutHysteresis('stacked', candidate, 1230)).toBe('stacked');
    expect(applyLayoutHysteresis('stacked', candidate, 1248)).toBe('paired');
    expect(applyLayoutHysteresis('paired', { mode: 'stacked', requiredPairedWidth: 1200 }, 1199)).toBe('stacked');
  });
});

describe('PDF Canvas 显示度量', () => {
  it('按 CSS 显示尺寸和 DPR 生成清晰位图', () => {
    const metrics = computePageDisplayMetrics({
      baseWidth: 612,
      baseHeight: 792,
      requestedScale: 1.8,
      allocatedWidth: 1101.6,
      devicePixelRatio: 2,
    });

    expect(metrics.cssWidth).toBeCloseTo(1101.6, 5);
    expect(metrics.cssHeight).toBeCloseTo(1425.6, 5);
    expect(metrics.outputScale).toBe(2);
    expect(metrics.bitmapWidth).toBe(2204);
    expect(metrics.bitmapHeight).toBe(2852);
    expect(metrics.bitmapWidth * metrics.bitmapHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 5_000);
  });

  it('受像素预算限制但不会把输出倍率降到 1 以下', () => {
    const metrics = computePageDisplayMetrics({
      baseWidth: 1000,
      baseHeight: 1400,
      requestedScale: 2,
      allocatedWidth: 2000,
      devicePixelRatio: 3,
    });

    expect(metrics.outputScale).toBeCloseTo(Math.sqrt(MAX_CANVAS_PIXELS / (2000 * 2800)), 5);
    expect(metrics.outputScale).toBeGreaterThanOrEqual(1);
    expect(metrics.outputScale).toBeLessThanOrEqual(2);
  });

  it('空间不足时让显示比例服从已分配宽度而不是依赖 CSS 偷缩放', () => {
    const metrics = computePageDisplayMetrics({
      baseWidth: 612,
      baseHeight: 792,
      requestedScale: 3,
      allocatedWidth: 1200,
      devicePixelRatio: 1,
    });

    expect(metrics.displayScale).toBeCloseTo(1200 / 612, 5);
    expect(metrics.cssWidth).toBe(1200);
    expect(metrics.fittedToContainer).toBe(true);
  });

  it('只有页面显示尺寸或有效输出倍率显著变化时才重绘', () => {
    const previous = computePageDisplayMetrics({
      baseWidth: 612,
      baseHeight: 792,
      requestedScale: 1,
      allocatedWidth: 612,
      devicePixelRatio: 1,
    });
    expect(shouldRerenderPage(previous, { ...previous, cssWidth: previous.cssWidth + 0.4 })).toBe(false);
    expect(shouldRerenderPage(previous, { ...previous, cssWidth: previous.cssWidth + 0.6 })).toBe(true);
    expect(shouldRerenderPage(previous, { ...previous, outputScale: previous.outputScale + 0.1 })).toBe(true);
  });
});
