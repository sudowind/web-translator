import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AgentPanel } from '../../../src/agent/AgentPanel';

const props = {
  pageCount: 15,
  messages: [{ role: 'assistant' as const, content: '回答内容' }],
  busy: false,
  onAsk: vi.fn(async () => undefined),
  onStop: vi.fn(),
  onNavigate: vi.fn(),
  onToggle: vi.fn(),
};

describe('论文智能体侧栏', () => {
  it('关闭时完全不渲染占位栏，展开时保留标题、消息和输入区', () => {
    const closed = renderToStaticMarkup(<AgentPanel {...props} open={false} />);
    const open = renderToStaticMarkup(<AgentPanel {...props} open />);

    expect(closed).toBe('');
    expect(open).toContain('class="agent-panel"');
    expect(open).toContain('class="agent-panel-header"');
    expect(open).toContain('class="agent-panel-body"');
    expect(open).toContain('论文智能体');
    expect(open).toContain('收起');
    expect(open).toContain('回答内容');
    expect(open).toContain('class="agent-composer"');
    expect(open).not.toContain('展开论文智能体');
  });
});
