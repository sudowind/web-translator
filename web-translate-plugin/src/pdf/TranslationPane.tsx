import katex from 'katex';
import React from 'react';

import type { DocumentPage } from '../document/model';
import type { TranslationResult } from '../providers/openai/contracts';
import type { TranslationFailure } from '../translation/failure';

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
          return (
            <p key={block.id}>
              {translations.get(block.id)?.text ?? (status === 'failed' ? '翻译失败' : '翻译中…')}
            </p>
          );
        })}
      </div>
    </section>
  );
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
