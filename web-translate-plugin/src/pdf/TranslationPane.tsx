import katex from 'katex';
import React from 'react';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import type { TranslationFailure } from '../translation/failure';
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
  pageFailures,
  pageAttempts,
  pageHeights,
  onPageVisible,
  onPageBoundary,
  onRetryPage,
  onCopyFailure,
}: {
  model: DocumentModel;
  translations: Map<string, TranslationResult>;
  pageStatus: Map<number, TranslationPageStatus>;
  pageFailures: ReadonlyMap<number, TranslationFailure>;
  pageAttempts: ReadonlyMap<number, number>;
  pageHeights: ReadonlyMap<number, number>;
  onPageVisible(page: number, progress: number): void;
  onPageBoundary(page: number, direction: -1 | 1): void;
  onRetryPage(page: number): void;
  onCopyFailure(failure: TranslationFailure): void;
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
        const failure = pageFailures.get(number);
        const attempt = pageAttempts.get(number);
        return (
          <section
            key={page.id}
            className="translation-page"
            style={{ height: pageHeights.get(number) ?? 780 }}
            data-translation-page={number}
            data-status={status}
          >
            <header>
              <h2>第 {number} 页</h2>
              <span>{attempt && (status === 'translating' || status === 'retrying') ? `第 ${attempt}/3 次尝试` : statusLabel(status)}</span>
            </header>
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
              {failure && (
                <div className="translation-failure">
                  <p role="alert">失败：{failure.summary}</p>
                  <button type="button" onClick={() => onRetryPage(number)}>重试本页</button>
                  <details>
                    <summary>查看详情</summary>
                    <dl>
                      <dt>错误码</dt><dd>{failure.code}</dd>
                      <dt>分类</dt><dd>{failure.category}</dd>
                      {failure.httpStatus !== undefined && <><dt>HTTP 状态</dt><dd>{failure.httpStatus}</dd></>}
                      <dt>模型</dt><dd>{failure.model}</dd>
                      <dt>耗时</dt><dd>{failure.durationMs} ms</dd>
                      <dt>尝试次数</dt><dd>{failure.attempts}</dd>
                      <dt>发生时间</dt><dd>{new Date(failure.occurredAt).toLocaleString()}</dd>
                      <dt>可重试</dt><dd>{failure.retryable ? '是' : '否'}</dd>
                    </dl>
                    <button type="button" onClick={() => onCopyFailure(failure)}>复制诊断信息</button>
                  </details>
                </div>
              )}
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
