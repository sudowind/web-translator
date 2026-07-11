import katex from 'katex';
import React from 'react';

import type { DocumentModel } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';

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
  onPageVisible,
}: {
  model: DocumentModel;
  translations: Map<string, TranslationResult>;
  pageStatus: Map<number, TranslationPageStatus>;
  onPageVisible(page: number, progress: number): void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
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

  return (
    <div ref={rootRef} className="translation-pages" aria-label="逐页译文">
      {model.pages.map((page) => {
        const number = page.index + 1;
        const status = pageStatus.get(number) ?? 'pending';
        return (
          <section key={page.id} data-translation-page={number} data-status={status}>
            <header><h2>第 {number} 页</h2><span>{statusLabel(status)}</span></header>
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
