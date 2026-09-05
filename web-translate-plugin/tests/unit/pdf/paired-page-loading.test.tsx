// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const pdfMocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: pdfMocks.getDocument,
  GlobalWorkerOptions: {},
}));
vi.mock('../../../src/pdf/PdfTextLayer', () => ({ PdfTextLayer: () => null }));

import { DOCUMENT_SCHEMA_VERSION, type DocumentModel } from '../../../src/document/model';
import { PairedPageViewer } from '../../../src/pdf/PairedPageViewer';

function longModel(): DocumentModel {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: 'long', sourceUrl: 'https://x.test/long.pdf', hash: 'long', title: 'Long', pageCount: 76,
    pages: Array.from({ length: 76 }, (_, index) => ({
      id: `p${index + 1}`,
      index,
      blocks: [{ id: `p${index + 1}:b1`, pageId: `p${index + 1}`, order: 0, kind: 'paragraph', text: `Page ${index + 1}` }],
    })),
  };
}

describe('长 PDF 页面加载窗口', () => {
  it('arXiv 使用 URL 输入且 PDF.js 未就绪时先按缓存模型渲染译文窗口', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    pdfMocks.getDocument.mockReturnValue({
      promise: new Promise(() => undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.IntersectionObserver = class {
      constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<PairedPageViewer
          url="https://arxiv.org/pdf/2510.12403"
          scale={1}
          activePage={40}
          navigationPage={40}
          model={longModel()}
          translationsByPage={new Map()}
          translationMode="on-demand"
          pageStatus={new Map()}
          pageFailures={new Map()}
          pageAttempts={new Map()}
          onDocumentReady={vi.fn()}
          onPageVisible={vi.fn()}
          onRetryPage={vi.fn()}
          onRequestPage={vi.fn()}
          onCopyFailure={vi.fn()}
          onBlockPreview={vi.fn()}
          onBlockPin={vi.fn()}
        />);
        await Promise.resolve();
      });
      expect(pdfMocks.getDocument).toHaveBeenCalledWith({
        url: 'https://arxiv.org/pdf/2510.12403',
      });
      expect(container.querySelectorAll('[data-page-pair]')).toHaveLength(76);
      expect(container.querySelectorAll('[data-translation-body="full"]')).toHaveLength(5);
      expect(container.querySelectorAll('canvas')).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      globalThis.IntersectionObserver = originalIntersectionObserver;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('76 页仅挂载 5 页译文正文，初始与缩放均不重复读取页面 proxy', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const getPage = vi.fn(async (pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => pageNumber === 40
        ? ({ width: 800 * scale, height: 400 * scale })
        : ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      cleanup: vi.fn(),
    }));
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 76, getPage }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });

    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalRequestIdleCallback = globalThis.requestIdleCallback;
    const originalCancelIdleCallback = globalThis.cancelIdleCallback;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    let notifyVisiblePdf!: IntersectionObserverCallback;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.rootMargin === '-68px 0px 0px 0px') notifyVisiblePdf = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    globalThis.requestIdleCallback = vi.fn(() => 1);
    globalThis.cancelIdleCallback = vi.fn();

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const model = longModel();
    const common = {
      bytes: new TextEncoder().encode('%PDF-1'),
      activePage: 40,
      navigationPage: 40,
      model,
      translationsByPage: new Map(),
      translationMode: 'on-demand' as const,
      pageStatus: new Map(),
      pageFailures: new Map(),
      pageAttempts: new Map(),
      onDocumentReady: vi.fn(),
      onPageVisible: vi.fn(),
      onRetryPage: vi.fn(),
      onRequestPage: vi.fn(),
      onCopyFailure: vi.fn(),
      onBlockPreview: vi.fn(),
      onBlockPin: vi.fn(),
    };

    try {
      await act(async () => {
        root.render(<PairedPageViewer {...common} scale={1} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelectorAll('[data-page-pair]')).toHaveLength(76);
      expect(container.querySelectorAll('[data-translation-body="full"]')).toHaveLength(5);
      expect(getPage.mock.calls.map(([page]) => page).sort((a, b) => a - b)).toEqual([38, 39, 40, 41, 42]);

      const adjacent = container.querySelector<HTMLElement>('[data-page-pair="41"] .pdf-page-canvas-wrap')!;
      expect(adjacent.dataset.outputScale).toBe('1.25');
      await act(async () => {
        notifyVisiblePdf([{ target: container.querySelector('[data-pdf-page="41"]'), isIntersecting: true,
          intersectionRect: { width: 300, height: 80 } } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      expect(adjacent.dataset.outputScale).toBe('1.5');
      expect(common.onPageVisible).not.toHaveBeenCalled();
      expect(getPage).toHaveBeenCalledTimes(5);

      const activeTranslation = container.querySelector<HTMLElement>('[data-translation-page="40"]')!;
      const renderCountBeforePreview = activeTranslation.dataset.translationRenderCount;
      await act(async () => {
        root.render(<PairedPageViewer {...common} highlightedBlockId="p40:b1" scale={1} />);
        await Promise.resolve();
      });
      expect(activeTranslation.dataset.translationRenderCount).toBe(renderCountBeforePreview);

      await act(async () => {
        root.render(<PairedPageViewer {...common} scale={1.5} />);
        await Promise.resolve();
      });
      expect(getPage).toHaveBeenCalledTimes(5);
      const unknownPageHeight = container.querySelector<HTMLElement>('[data-page-pair="1"]')!.style.height;

      await act(async () => {
        root.render(<PairedPageViewer {...common} activePage={60} navigationPage={60} scale={1.5} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector<HTMLElement>('[data-page-pair="1"]')!.style.height).toBe(unknownPageHeight);
      expect(getPage).toHaveBeenCalledTimes(10);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      globalThis.IntersectionObserver = originalIntersectionObserver;
      globalThis.ResizeObserver = originalResizeObserver;
      globalThis.requestIdleCallback = originalRequestIdleCallback;
      globalThis.cancelIdleCallback = originalCancelIdleCallback;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });
});
