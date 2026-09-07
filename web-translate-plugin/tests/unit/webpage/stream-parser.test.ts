import { describe, expect, it } from 'vitest';
import { WebpageStreamParser, validateInlineResult } from '../../../src/webpage/stream-parser';
import { summarizeTiming } from '../../../src/webpage/timing';

describe('逐块流式协议', () => {
  it('跨任意字符边界只发出完整对象，处理引号、反斜杠和括号', () => {
    const results: unknown[] = [];
    const parser = new WebpageStreamParser([{ id: 'a', text: 'Hi' }, { id: 'b', text: 'Next' }], r => results.push(r));
    const first = { id: 'a', text: '你好 " } \\ 世界' };
    for (const char of '{"translations":[' + JSON.stringify(first)) parser.push(char);
    expect(results).toEqual([first]);
    parser.push(',{"id":"b","text":"下'); expect(results).toHaveLength(1);
    parser.push('一个"}]}'); expect(results).toHaveLength(2);
    parser.finish([first, { id: 'b', text: '下一个' }]);
  });
  it('重复、未知 id 和最终冲突不能被接受', () => {
    for (const id of ['a', 'unknown']) {
      const parser = new WebpageStreamParser([{ id: 'a', text: 'Hi' }], () => undefined);
      parser.push(`{"translations":[{"id":"a","text":"好"},{"id":"${id}","text":"坏"}]}`);
      expect(parser.invalid).toBe(true);
      expect(() => parser.finish([{ id: 'a', text: '好' }])).toThrow();
    }
    const parser = new WebpageStreamParser([{ id: 'a', text: 'Hi' }], () => undefined);
    parser.push('{"translations":[{"id":"a","text":"好"}');
    expect(() => parser.finish([{ id: 'a', text: '变更' }])).toThrow();
  });
  it('保留标记类型与父子关系，允许兄弟顺序调整', () => {
    const source = '⟦wt:0⟧Hello⟦/wt:0⟧ ⟦wt:1/⟧';
    expect(() => validateInlineResult(source, '⟦wt:1/⟧ ⟦wt:0⟧你好⟦/wt:0⟧')).not.toThrow();
    for (const text of ['', '你好', '⟦wt:0⟧⟦wt:1/⟧你好⟦/wt:0⟧', '⟦wt:0/⟧⟦wt:1/⟧']) expect(() => validateInlineResult(source, text)).toThrow();
  });
  it('TTFT 排除无首内容样本，统计中位数及最近秩 P95', () => {
    expect(summarizeTiming([{ ttftMs: 100, durationMs: 1000 }, { ttftMs: 300, durationMs: 2000 }, { durationMs: 3000 }])).toContain('TTFT 中位 0.20s / P95 0.30s（2 次）');
  });
});
