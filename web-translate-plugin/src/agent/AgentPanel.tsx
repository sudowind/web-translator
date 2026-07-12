import React from 'react';

import { MarkdownContent } from '../rendering/MarkdownContent';
import type { AgentMessage } from './context-builder';

export type ReferencePart =
  | { kind: 'text'; value: string }
  | { kind: 'reference'; page: number };

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
  if (!open) {
    return <aside className="agent-panel collapsed"><button type="button" onClick={onToggle}>展开论文智能体</button></aside>;
  }
  return (
    <aside className="agent-panel" aria-label="论文智能体">
      <header><strong>论文智能体</strong><button type="button" onClick={onToggle}>收起</button></header>
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">模型正在思考或生成回答…</p>}
      {error && <p role="alert">{error}</p>}
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
      <form onSubmit={(event) => {
        event.preventDefault();
        const value = question.trim();
        if (!value) return;
        setQuestion('');
        void onAsk(value);
      }}>
        <label htmlFor="pdf-agent-question">向论文提问</label>
        <textarea id="pdf-agent-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <div className="agent-actions">
          <button type="submit" disabled={busy || !question.trim()}>发送</button>
          <button type="button" disabled={!busy} onClick={onStop}>停止</button>
        </div>
      </form>
    </aside>
  );
}
