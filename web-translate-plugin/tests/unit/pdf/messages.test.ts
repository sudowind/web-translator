import { describe, expect, it } from 'vitest';

import { isPdfAgentProgress, isPdfMessage } from '../../../src/pdf/messages';

describe('PDF 工作台消息', () => {
  it.each([
    { type: 'pdf:parse-start', source: { url: 'https://example.test/p.pdf', hash: 'sha256:x', title: 'p.pdf', size: 12, kind: 'remote' }, pageCount: 2, consent: false },
    { type: 'pdf:document-get', hash: 'sha256:x' },
    { type: 'pdf:translation-snapshot', hash: 'sha256:x' },
    { type: 'pdf:translate-page', hash: 'sha256:x', page: 1 },
    { type: 'pdf:history-update', hash: 'sha256:x', title: 'Paper', page: 2, pageCount: 10 },
    { type: 'pdf:agent-ask', hash: 'sha256:x', requestId: 'agent-1', activePage: 1, selection: '', recentMessages: [], question: '贡献？', maxCharacters: 1000 },
    { type: 'pdf:agent-cancel' },
    { type: 'pdf:cancel' },
    { type: 'pdf:cache-clear', hash: 'sha256:x' },
  ])('接受精确合法消息：$type', (message) => {
    expect(isPdfMessage(message)).toBe(true);
    expect(isPdfMessage({ ...message, token: 'secret' })).toBe(false);
  });

  it('严格校验 Agent 流式进度消息', () => {
    const progress = { type: 'pdf:agent-progress', hash: 'sha256:x', requestId: 'agent-1', delta: '部分回答' };
    expect(isPdfAgentProgress(progress)).toBe(true);
    expect(isPdfAgentProgress({ ...progress, delta: ' \n' })).toBe(true);
    expect(isPdfAgentProgress({ ...progress, requestId: '' })).toBe(false);
    expect(isPdfAgentProgress({ ...progress, delta: '' })).toBe(false);
    expect(isPdfAgentProgress({ ...progress, token: 'secret' })).toBe(false);
    expect(isPdfAgentProgress({ ...progress, type: 'pdf:translation-progress' })).toBe(false);
  });

  it('拒绝越界页码、未知类型和含凭据字段的消息', () => {
    expect(isPdfMessage({ type: 'pdf:translate-page', hash: 'h', page: 0 })).toBe(false);
    expect(isPdfMessage({ type: 'pdf:history-update', hash: 'h', title: 'P', page: 11, pageCount: 10 })).toBe(false);
    expect(isPdfMessage({ type: 'pdf:unknown' })).toBe(false);
    expect(isPdfMessage({ type: 'pdf:cancel', apiKey: 'secret' })).toBe(false);
    expect(isPdfMessage({ type: 'pdf:parse-start', source: {}, consent: false })).toBe(false);
    expect(isPdfMessage({ type: 'pdf:source', url: 'https://example.test/p.pdf' })).toBe(false);
  });

  it.each([
    { bytes: [37, 80, 68, 70, 45] },
    { bytesBase64: 'JVBERi0=' },
  ])('拒绝在 parse-start 中回传完整 PDF 字节：$bytesBase64', (payload) => {
    expect(isPdfMessage({
      type: 'pdf:parse-start',
      source: {
        url: 'https://example.test/p.pdf',
        hash: 'sha256:x',
        title: 'p.pdf',
        size: 12,
        kind: 'remote',
        ...payload,
      },
      pageCount: 2,
      consent: false,
    })).toBe(false);
  });
});
