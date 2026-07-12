import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AgentPanel, referenceParts } from '../../../src/agent/AgentPanel';

describe('论文智能体面板', () => {
  it('只把文档范围内 [p:N] 解析为可导航引用', () => {
    expect(referenceParts('See [p:2] and [p:9]', 3)).toEqual([
      { kind: 'text', value: 'See ' }, { kind: 'reference', page: 2 },
      { kind: 'text', value: ' and ' }, { kind: 'text', value: '[p:9]' },
    ]);
  });

  it('渲染压缩提示、对话、停止和收起控件', () => {
    const html = renderToStaticMarkup(<AgentPanel open pageCount={3} notice="已使用压缩上下文" messages={[{ role: 'assistant', content: 'Answer [p:2]' }]} busy error={undefined} onAsk={async () => undefined} onStop={() => undefined} onNavigate={() => undefined} onToggle={() => undefined} />);
    expect(html).toContain('已使用压缩上下文');
    expect(html).toContain('第 2 页');
    expect(html).toContain('停止');
    expect(html).toContain('收起');
    expect(html).toContain('模型正在思考或生成回答…');
  });
});
