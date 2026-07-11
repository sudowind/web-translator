// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPdfFirstPage } from '../../../src/pdf-takeover/render-first-page';

describe('renderPdfFirstPage', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body><p>原 PDF DOM</p></body>';
    sessionStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
  });

  it('PDF.js 页面渲染完成后才返回 rendererVerified', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const getPage = vi.fn(async () => ({
      getViewport: () => ({ width: 612, height: 792 }),
      render,
    }));
    const loader = vi.fn(() => ({
      promise: Promise.resolve({ getPage }),
    }));

    const result = await renderPdfFirstPage('https://papers.example/a.pdf', loader);

    expect(result).toMatchObject({ injected: true, rendererVerified: true });
    expect(getPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalled();
    const canvas = document.querySelector('canvas');
    expect(canvas).toMatchObject({ width: 612, height: 792 });
    expect(document.querySelector('[data-renderer="pdfjs-probe"]')).not.toBeNull();
  });
});
