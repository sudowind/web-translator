import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export interface MarkdownContentProps {
  content: string;
  pageCount?: number;
  onNavigatePage?(page: number): void;
  className?: string;
}

export function normalizePageReferences(content: string, pageCount?: number): string {
  if (!pageCount || pageCount < 1) return content;
  return content.replace(/\[p:(\d+)\]/g, (reference, rawPage: string) => {
    const page = Number(rawPage);
    return page >= 1 && page <= pageCount
      ? `[第 ${page} 页](pdf-page:${page})`
      : reference;
  });
}

export function safeMarkdownUrl(url: string): string {
  if (/^pdf-page:\d+$/.test(url)) return url;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : '';
  } catch {
    return '';
  }
}

export function MarkdownContent({
  content,
  pageCount,
  onNavigatePage,
  className,
}: MarkdownContentProps) {
  return (
    <div className={['markdown-content', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ href, children }) => {
            const match = /^pdf-page:(\d+)$/.exec(href ?? '');
            if (match) {
              const page = Number(match[1]);
              return (
                <button type="button" className="page-reference" onClick={() => onNavigatePage?.(page)}>
                  {children}
                </button>
              );
            }
            return <a href={href} rel="noreferrer noopener" target="_blank">{children}</a>;
          },
          table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
        }}
      >
        {normalizePageReferences(content, pageCount)}
      </ReactMarkdown>
    </div>
  );
}
