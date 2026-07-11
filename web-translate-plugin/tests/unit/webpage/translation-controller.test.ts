import { describe, expect, it } from 'vitest';

import { scanTextNodes } from '../../../src/webpage/scan-text';
import { TranslationController } from '../../../src/webpage/translation-controller';

describe('原位翻译控制器', () => {
  it('仅修改原 Text.data，支持单块查看原文与完整幂等恢复', () => {
    document.body.innerHTML =
      '<p id="first" class="keep">Hello world</p><p id="second">Second text</p>';
    const firstParent = document.querySelector('#first')!;
    const secondParent = document.querySelector('#second')!;
    const firstNode = firstParent.firstChild as Text;
    const secondNode = secondParent.firstChild as Text;
    const blocks = scanTextNodes(document.body);
    const controller = new TranslationController(blocks);

    controller.apply([
      { id: blocks[0].id, text: '你好，世界' },
      { id: blocks[1].id, text: '第二段' },
    ]);

    expect(firstNode.data).toBe('你好，世界');
    expect(secondNode.data).toBe('第二段');
    expect(document.querySelector('#first')).toBe(firstParent);
    expect(document.querySelector('#second')).toBe(secondParent);
    expect(firstParent.className).toBe('keep');

    controller.revealOriginal(blocks[0].id);
    expect(firstNode.data).toBe('Hello world');
    expect(secondNode.data).toBe('第二段');

    controller.restore();
    controller.restore();
    expect(firstNode.data).toBe('Hello world');
    expect(secondNode.data).toBe('Second text');
    expect(firstParent.attributes).toHaveLength(2);
    expect(secondParent.attributes).toHaveLength(1);
  });

  it('安全跳过已经断开的文本节点和未知 id', () => {
    document.body.innerHTML = '<p>Connected text</p><p>Detached text</p>';
    const blocks = scanTextNodes(document.body);
    const detachedParent = blocks[1].node.parentElement!;
    detachedParent.remove();
    const controller = new TranslationController(blocks);

    expect(() =>
      controller.apply([
        { id: blocks[0].id, text: '已连接' },
        { id: blocks[1].id, text: '已断开' },
        { id: 'unknown', text: '未知' },
      ]),
    ).not.toThrow();
    expect(blocks[0].node.data).toBe('已连接');
    expect(blocks[1].node.data).toBe('Detached text');
    expect(() => controller.revealOriginal('unknown')).not.toThrow();
    expect(() => controller.restore()).not.toThrow();
  });
});
