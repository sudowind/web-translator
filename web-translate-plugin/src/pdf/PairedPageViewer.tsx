import React from 'react';
import {
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import type { TranslationFailure } from '../translation/failure';
import { PdfPageCanvas, visiblePageWindow } from './PdfViewer';
import { TranslationPage, type TranslationPageStatus } from './TranslationPane';
import { selectDominantPage } from './visible-page';

export interface PagePairProps {
  number: number;
  height: number;
  pdf: React.ReactNode;
  translation: React.ReactNode;
}

export function fitPageHeight(pageWidth: number, pageHeight: number, availableWidth: number): number {
  if (pageWidth <= 0 || pageHeight <= 0 || availableWidth <= 0) return 780;
  return pageHeight * Math.min(1, availableWidth / pageWidth);
}

export function PagePair({ number, height, pdf, translation }: PagePairProps) {
  return (
    <section
      className="page-pair"
      data-page-pair={number}
      aria-label={`第 ${number} 页原文与译文`}
      style={{ height }}
    >
      <div className="page-pair-pdf" data-pdf-page={number} style={{ height }}>{pdf}</div>
      <div className="page-pair-translation" style={{ height }}>{translation}</div>
    </section>
  );
}

interface PairedPageViewerProps {
  bytes: Uint8Array;
  scale: number;
  activePage: number;
  navigationPage: number;
  model: DocumentModel | null;
  translations: ReadonlyMap<string, TranslationResult>;
  pageStatus: ReadonlyMap<number, TranslationPageStatus>;
  pageFailures: ReadonlyMap<number, TranslationFailure>;
  pageAttempts: ReadonlyMap<number, number>;
  translationPlaceholder?: React.ReactNode;
  onDocumentReady(pageCount: number): void;
  onPageVisible(page: number, progress: number): void;
  onRetryPage(page: number): void;
  onCopyFailure(failure: TranslationFailure): void;
}

export function PairedPageViewer({
  bytes,
  scale,
  activePage,
  navigationPage,
  model,
  translations,
  pageStatus,
  pageFailures,
  pageAttempts,
  translationPlaceholder,
  onDocumentReady,
  onPageVisible,
  onRetryPage,
  onCopyFailure,
}: PairedPageViewerProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const activePageRef = React.useRef(activePage);
  const lastReportedPage = React.useRef<number | null>(null);
  const lastNavigationPage = React.useRef<number | null>(null);
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [pageSizes, setPageSizes] = React.useState<ReadonlyMap<number, { width: number; height: number }>>(new Map());
  const [pageHeights, setPageHeights] = React.useState<ReadonlyMap<number, number>>(new Map());
  activePageRef.current = activePage;

  React.useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: bytes.slice() });
    void task.promise.then((pdf) => {
      if (cancelled) return;
      setDocument(pdf);
      setPageCount(pdf.numPages);
      onDocumentReady(pdf.numPages);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, onDocumentReady]);

  React.useEffect(() => {
    if (!document || pageCount === 0) return;
    let cancelled = false;
    void Promise.all(Array.from({ length: pageCount }, async (_, index) => {
      const number = index + 1;
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale });
      return [number, { width: viewport.width, height: viewport.height }] as const;
    })).then((entries) => {
      if (!cancelled) setPageSizes(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [document, pageCount, scale]);

  const fitAllPageHeights = React.useCallback(() => {
    const availableWidth = rootRef.current?.querySelector<HTMLElement>('.page-pair-pdf')?.clientWidth ?? 0;
    if (availableWidth <= 0 || pageSizes.size !== pageCount) return;
    setPageHeights(new Map(Array.from(pageSizes, ([number, size]) => [
      number,
      fitPageHeight(size.width, size.height, availableWidth),
    ])));
  }, [pageCount, pageSizes]);

  React.useLayoutEffect(fitAllPageHeights, [fitAllPageHeights]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(fitAllPageHeights);
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitAllPageHeights]);

  React.useEffect(() => {
    if (!rootRef.current || pageCount === 0) return;
    const visibility = new Map<number, { ratio: number; progress: number }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.pagePair);
        if (!entry.isIntersecting) {
          visibility.delete(page);
          continue;
        }
        const viewportTop = entry.rootBounds?.top ?? 0;
        const height = Math.max(1, entry.boundingClientRect.height);
        visibility.set(page, {
          ratio: entry.intersectionRatio,
          progress: Math.max(0, Math.min(1, (viewportTop - entry.boundingClientRect.top) / height)),
        });
      }
      const page = selectDominantPage(
        Array.from(visibility, ([candidate, value]) => ({ page: candidate, intersectionRatio: value.ratio })),
        lastReportedPage.current ?? activePageRef.current,
      );
      if (page === null || page === lastReportedPage.current) return;
      lastReportedPage.current = page;
      onPageVisible(page, visibility.get(page)?.progress ?? 0);
    }, { root: null, threshold: [0.25, 0.6] });
    rootRef.current.querySelectorAll<HTMLElement>('[data-page-pair]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [onPageVisible, pageCount]);

  React.useLayoutEffect(() => {
    if (!rootRef.current || pageCount === 0 || pageHeights.size !== pageCount || lastNavigationPage.current === navigationPage) return;
    const target = rootRef.current.querySelector<HTMLElement>(`[data-page-pair="${navigationPage}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: lastNavigationPage.current === null ? 'auto' : 'smooth' });
    lastNavigationPage.current = navigationPage;
  }, [navigationPage, pageCount, pageHeights]);

  const onHeightChange = React.useCallback((page: number, height: number) => {
    setPageHeights((current) => {
      if (Math.abs((current.get(page) ?? 0) - height) < 0.5) return current;
      const next = new Map(current);
      next.set(page, height);
      return next;
    });
  }, []);

  const renderWindow = visiblePageWindow(activePage, pageCount);
  return (
    <div ref={rootRef} className="paired-page-stream" aria-label="PDF 原文与逐页译文">
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => {
        const height = pageHeights.get(number) ?? 780;
        const page = model?.pages[number - 1];
        return (
          <PagePair
            key={number}
            number={number}
            height={height}
            pdf={document && renderWindow.has(number)
              ? <PdfPageCanvas document={document} pageNumber={number} scale={scale} onHeightChange={onHeightChange} />
              : <div className="pdf-page-placeholder" aria-hidden="true" />}
            translation={page
              ? <TranslationPage
                page={page}
                number={number}
                height={height}
                translations={translations}
                status={pageStatus.get(number) ?? 'pending'}
                failure={pageFailures.get(number)}
                attempt={pageAttempts.get(number)}
                onRetry={() => onRetryPage(number)}
                onCopyFailure={onCopyFailure}
              />
              : <div className="translation-page translation-page-placeholder" style={{ height }}>{translationPlaceholder ?? '等待 MinerU 解析'}</div>}
          />
        );
      })}
    </div>
  );
}
