import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../../src/agent/context-builder';
import {
  appendAgentDelta,
  finalizeAgentAnswer,
  stopAgentAnswer,
} from '../../../src/agent/stream-state';

function streaming(requestId: string, content = ''): AgentMessage[] {
  return [{ role: 'assistant', content, requestId, status: 'streaming' }];
}

describe('Agent 流式消息状态', () => {
  it('只向匹配 requestId 的 assistant 消息追加增量', () => {
    const state = streaming('r1', '甲');
    expect(appendAgentDelta(state, 'old', '乙')).toBe(state);
    expect(appendAgentDelta(state, 'r1', '乙')[0]).toMatchObject({ content: '甲乙', status: 'streaming' });
  });

  it('最终响应校准增量内容并标记完成', () => {
    expect(finalizeAgentAnswer(streaming('r1', '临时'), 'r1', '最终')[0]).toMatchObject({
      content: '最终', status: 'done', requestId: 'r1',
    });
  });

  it('停止后保留已生成内容', () => {
    expect(stopAgentAnswer(streaming('r1', '部分'), 'r1')[0]).toMatchObject({
      content: '部分', status: 'stopped',
    });
  });
});
