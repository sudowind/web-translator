import katex from 'katex';
import React from 'react';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { pageWheelAction } from './page-wheel';

export type TranslationPageStatus =
  | 'pending'
  | 'parsing'
  | 'translating'
  | 'retrying'
  | 'done'
  | 'failed';

export function TranslationPane({
  model,
  translations,
  pageStatus,
  pageHeights,
  onPageVisible,
  onPageBoundary,
}: {
  model: DocumentModel;
  translations: Map<string, TranslationResult>;
  pageStatus: Map<number, TranslationPageStatus>;
  pageHeights: ReadonlyMap<number, number>;
  onPageVisible(page: number, progress: number): void;
  onPageBoundary(page: number, direction: -1 | 1): void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const touchY = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!rootRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = Number((entry.target as HTMLElement).dataset.translationPage);
        const rootTop = entry.rootBounds?.top ?? 0;
        const height = Math.max(1, entry.boundingClientRect.height);
        onPageVisible(page, Math.max(0, Math.min(1, (rootTop - entry.boundingClientRect.top) / height)));
      }
    }, { root: rootRef.current, threshold: [0.25, 0.6] });
    rootRef.current.querySelectorAll<HTMLElement>('[data-translation-page]').forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [model, onPageVisible]);

  const handlePageDirection = React.useCallback((
    element: HTMLElement,
    page: number,
    deltaY: number,
  ) => {
    const action = pageWheelAction(element, deltaY);
    if (action === 'inner') return false;
    onPageBoundary(page, action === 'next' ? 1 : -1);
    return true;
  }, [onPageBoundary]);

  return (
    <div ref={rootRef} className="translation-pages" aria-label="逐页译文">
      {model.pages.map((page) => {
        const number = page.index + 1;
        const status = pageStatus.get(number) ?? 'pending';
        return (
          <section
            key={page.id}
            className="translation-page"
            style={{ height: pageHeights.get(number) ?? 780 }}
            data-translation-page={number}
            data-status={status}
          >
            <header><h2>第 {number} 页</h2><span>{statusLabel(status)}</span></header>
            <div
              className="translation-page-body"
              tabIndex={0}
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => {
                event.stopPropagation();
                if (handlePageDirection(event.currentTarget, number, event.deltaY)) event.preventDefault();
              }}
              onKeyDown={(event) => {
                const deltaY = event.key === 'ArrowDown' || event.key === 'PageDown'
                  ? 1
                  : event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 0;
                if (deltaY === 0) return;
                event.stopPropagation();
                if (handlePageDirection(event.currentTarget, number, deltaY)) event.preventDefault();
              }}
              onTouchStart={(event) => {
                event.stopPropagation();
                touchY.current = event.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(event) => {
                event.stopPropagation();
                const currentY = event.touches[0]?.clientY;
                if (touchY.current === null || currentY === undefined) return;
                const deltaY = touchY.current - currentY;
                touchY.current = currentY;
                if (handlePageDirection(event.currentTarget, number, deltaY)) event.preventDefault();
              }}
              onTouchEnd={() => { touchY.current = null; }}
            >
              {page.blocks.map((block) => {
                if (block.kind === 'formula') {
                  const markup = katex.renderToString(block.latex ?? block.text, { throwOnError: false });
                  return <div key={block.id} className="translation-formula" dangerouslySetInnerHTML={{ __html: markup }} />;
                }
                if (block.kind === 'table') {
                  return <pre key={block.id}>{block.html ?? block.text}</pre>;
                }
                if (block.kind === 'figure') {
                  return <p key={block.id}>{block.text || block.resourceUrl || '图片'}</p>;
                }
                return <p key={block.id}>{translations.get(block.id)?.text ?? (status === 'failed' ? '翻译失败' : '翻译中…')}</p>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function statusLabel(status: TranslationPageStatus): string {
  return {
    pending: '等待', parsing: '解析中', translating: '翻译中', retrying: '重试中', done: '完成', failed: '失败',
  }[status];
}
