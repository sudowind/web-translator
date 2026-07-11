import { describe, expect, it } from 'vitest';

import type { TextBlock } from '../../../src/webpage/contracts';
import { ViewportQueue } from '../../../src/webpage/viewport-queue';

function block(id: string): TextBlock {
  const node = document.createTextNode(id);
  document.body.append(node);
  return { id, node, original: id };
}

describe('视口优先队列', () => {
  it('优先返回视口内文本并保持各优先级的文档顺序', () => {
    const blocks = ['a', 'b', 'c', 'd'].map(block);
    const queue = new ViewportQueue(
      blocks,
      ({ id }) => id === 'b' || id === 'd',
    );

    expect(queue.takeBatch(3).map(({ id }) => id)).toEqual(['b', 'd', 'a']);
    expect(queue.size).toBe(1);
    expect(queue.takeBatch(3).map(({ id }) => id)).toEqual(['c']);
    expect(queue.size).toBe(0);
  });

  it('非正数批量限制不消费队列', () => {
    const queue = new ViewportQueue([block('a')], () => true);

    expect(queue.takeBatch(0)).toEqual([]);
    expect(queue.size).toBe(1);
  });
});
