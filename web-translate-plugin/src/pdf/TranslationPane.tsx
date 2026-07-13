import katex from 'katex';
import React from 'react';

import type { DocumentBlock, DocumentPage } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import { MarkdownContent } from '../rendering/MarkdownContent';
import type { TranslationFailure } from '../translation/failure';
import { mineruPolygonToPercentRect } from './block-highlight';

export type TranslationPageStatus =
  | 'pending'
  | 'parsing'
  | 'translating'
  | 'retrying'
  | 'done'
  | 'failed';

export interface TranslationPageProps {
  page: DocumentPage;
  number: number;
  height: number;
  translations: ReadonlyMap<string, TranslationResult>;
  status: TranslationPageStatus;
  failure?: TranslationFailure;
  attempt?: number;
  pinnedBlockId?: string | null;
  onBlockPreview?(blockId: string | null): void;
  onBlockPin?(blockId: string): void;
  onRetry(): void;
  onCopyFailure(failure: TranslationFailure): void;
}

export function TranslationPage({
  page,
  number,
  height,
  translations,
  status,
  failure,
  attempt,
  pinnedBlockId,
  onBlockPreview = () => undefined,
  onBlockPin = () => undefined,
  onRetry,
  onCopyFailure,
}: TranslationPageProps) {
  return (
    <section
      className="translation-page"
      style={{ height }}
      data-translation-page={number}
      data-status={status}
      aria-label={`第 ${number} 页译文`}
    >
      <header>
        <h2>第 {number} 页</h2>
        <span>
          {attempt && (status === 'translating' || status === 'retrying')
            ? `第 ${attempt}/3 次尝试`
            : statusLabel(status)}
        </span>
      </header>
      <div className="translation-page-body" tabIndex={0}>
        {failure && (
          <div className="translation-failure">
            <p role="alert">失败：{failure.summary}</p>
            <button type="button" onClick={onRetry}>重试本页</button>
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
        {page.blocks.map((block) => (
          <TranslationBlock
            key={block.id}
            block={block}
            text={translations.get(block.id)?.text}
            fallback={status === 'failed' ? '翻译失败' : '翻译中…'}
            pinned={pinnedBlockId === block.id}
            onPreview={onBlockPreview}
            onPin={onBlockPin}
          />
        ))}
      </div>
    </section>
  );
}

function TranslationBlock({
  block,
  text,
  fallback,
  pinned,
  onPreview,
  onPin,
}: {
  block: DocumentBlock;
  text?: string;
  fallback: string;
  pinned: boolean;
  onPreview(blockId: string | null): void;
  onPin(blockId: string): void;
}) {
  const interactive = mineruPolygonToPercentRect(block.polygon) !== null;
  const content = text ?? (block.kind === 'figure' ? block.text || block.resourceUrl || '图片' : fallback);
  return (
    <article
      className="translation-block"
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-pinned={pinned ? 'true' : undefined}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? pinned : undefined}
      tabIndex={interactive ? 0 : undefined}
      onPointerEnter={() => interactive && onPreview(block.id)}
      onPointerLeave={() => interactive && onPreview(null)}
      onFocus={() => interactive && onPreview(block.id)}
      onBlur={() => interactive && onPreview(null)}
      onClick={() => interactive && onPin(block.id)}
      onKeyDown={(event) => {
        if (!interactive || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onPin(block.id);
      }}
    >
      {renderBlockContent(block, content)}
    </article>
  );
}

function renderBlockContent(block: DocumentBlock, content: string): React.ReactNode {
  if (block.kind === 'formula') {
    const markup = katex.renderToString(block.latex ?? block.text, { throwOnError: false, displayMode: true });
    return <div className="translation-formula" dangerouslySetInnerHTML={{ __html: markup }} />;
  }
  if (block.kind === 'heading') {
    const Heading = headingTagForLevel(block.headingLevel);
    return <Heading><MarkdownContent content={content} inline /></Heading>;
  }
  if (block.kind === 'table') {
    return <MarkdownContent content={content === '翻译中…' || content === '翻译失败' ? content : content || block.text} />;
  }
  return <MarkdownContent content={content} />;
}

function headingTagForLevel(level = 1): 'h3' | 'h4' | 'h5' | 'h6' {
  if (level <= 1) return 'h3';
  if (level === 2) return 'h4';
  if (level === 3) return 'h5';
  return 'h6';
}

function statusLabel(status: TranslationPageStatus): string {
  return {
    pending: '等待',
    parsing: '解析中',
    translating: '翻译中',
    retrying: '重试中',
    done: '完成',
    failed: '失败',
  }[status];
}
