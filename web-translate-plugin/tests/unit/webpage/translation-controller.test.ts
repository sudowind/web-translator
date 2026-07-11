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

    expect(controller.revealOriginal(blocks[0].id)).toBe('Hello world');
    expect(firstNode.data).toBe('你好，世界');
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
    expect(controller.revealOriginal('unknown')).toBeNull();
    expect(() => controller.restore()).not.toThrow();
  });

  it('可追加动态文本并清理自身原文属性', () => {
    document.body.innerHTML = '<main><p>Initial English</p></main>';
    const initial = scanTextNodes(document.body);
    const controller = new TranslationController(initial);
    const dynamic = document.createElement('p');
    dynamic.textContent = 'Dynamic English';
    document.querySelector('main')!.append(dynamic);
    const added = scanTextNodes(dynamic);

    controller.add(added);
    controller.apply([{ id: added[0].id, text: '动态译文' }]);
    expect(dynamic.dataset.webTranslateOriginal).toBe('Dynamic English');

    controller.restore();
    expect(dynamic.textContent).toBe('Dynamic English');
    expect(dynamic.hasAttribute('data-web-translate-original')).toBe(false);
    expect(dynamic.hasAttribute('data-web-translate-id')).toBe(false);
  });

  it('断开时保留恢复资格并在重连后的再次 restore 恢复原文', () => {
    document.body.innerHTML = '<p>Reconnect English</p>';
    const block = scanTextNodes(document.body)[0];
    const parent = block.node.parentElement!;
    const controller = new TranslationController([block]);
    controller.apply([{ id: block.id, text: '重连文本' }]);
    parent.remove();

    controller.restore();
    expect(block.node.data).toBe('重连文本');

    document.body.append(parent);
    controller.restore();
    expect(block.node.data).toBe('Reconnect English');
  });
});
