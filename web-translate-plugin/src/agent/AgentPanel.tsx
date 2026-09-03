import React from 'react';

import { MarkdownContent } from '../rendering/MarkdownContent';
import type { AgentMessage } from './context-builder';

export type ReferencePart =
  | { kind: 'text'; value: string }
  | { kind: 'reference'; page: number };

const suggestedQuestions = [
  '概括论文的主要贡献',
  '总结实验结论',
  '解释论文的关键方法',
] as const;

export function referenceParts(answer: string, pageCount: number): ReferencePart[] {
  return answer.split(/(\[p:\d+\])/g).filter(Boolean).map((part) => {
    const match = /^\[p:(\d+)\]$/.exec(part);
    if (!match) return { kind: 'text', value: part };
    const page = Number(match[1]);
    return page >= 1 && page <= pageCount
      ? { kind: 'reference', page }
      : { kind: 'text', value: part };
  });
}

export function AgentPanel({
  open,
  pageCount,
  notice,
  messages,
  busy,
  error,
  onAsk,
  onStop,
  onNavigate,
  onToggle,
}: {
  open: boolean;
  pageCount: number;
  notice?: string;
  messages: AgentMessage[];
  busy: boolean;
  error?: string;
  onAsk(question: string): Promise<void>;
  onStop(): void;
  onNavigate(page: number): void;
  onToggle(): void;
}) {
  const [question, setQuestion] = React.useState('');
  const questionRef = React.useRef<HTMLTextAreaElement>(null);
  if (!open) return null;
  return (
    <aside className="agent-panel" aria-label="论文智能体">
      <header className="agent-panel-header">
        <strong>论文智能体</strong>
        <button type="button" onClick={onToggle}>收起</button>
      </header>
      <div className="agent-panel-body">
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">模型正在思考或生成回答…</p>}
        {error && <p role="alert">{error}</p>}
        {messages.length === 0 && !busy && !error && (
          <div className="agent-empty-state">
            <span className="agent-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" />
                <path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
              </svg>
            </span>
            <strong>基于当前论文提问</strong>
            <p>智能体会结合论文内容回答，并用页码引用标出依据。</p>
            <div className="agent-suggestions" aria-label="建议问题">
              {suggestedQuestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="agent-suggestion"
                  onClick={() => {
                    setQuestion(suggestion);
                    requestAnimationFrame(() => questionRef.current?.focus());
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="agent-messages">
          {messages.map((message, index) => (
            <div key={index} data-role={message.role} data-status={message.status}>
              <MarkdownContent
                content={message.content || (message.status === 'streaming' ? '正在生成…' : '')}
                pageCount={pageCount}
                onNavigatePage={onNavigate}
              />
            </div>
          ))}
        </div>
      </div>
      <form className="agent-composer" onSubmit={(event) => {
        event.preventDefault();
        const value = question.trim();
        if (!value) return;
        setQuestion('');
        void onAsk(value);
      }}>
        <label htmlFor="pdf-agent-question">向论文提问</label>
        <textarea ref={questionRef} id="pdf-agent-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <div className="agent-actions">
          <button type="submit" disabled={busy || !question.trim()}>发送</button>
          <button type="button" disabled={!busy} onClick={onStop}>停止</button>
        </div>
      </form>
    </aside>
  );
}
