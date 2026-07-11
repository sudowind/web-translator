// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { MutationTranslationController } from '../../../src/webpage/mutation-controller';

describe('MutationTranslationController', () => {
  it('只上报新增且未处理的顶层根节点', async () => {
    document.body.innerHTML = '';
    const onRoots = vi.fn();
    const controller = new MutationTranslationController(document.body, onRoots);
    controller.start();
    controller.start();

    const section = document.createElement('section');
    section.innerHTML = '<p>New article text</p>';
    document.body.append(section);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRoots).toHaveBeenCalledTimes(1);
    expect(onRoots).toHaveBeenCalledWith([section]);
    controller.stop();
  });

  it('停止后忽略新增节点和插件自身 UI', async () => {
    document.body.innerHTML = '';
    const onRoots = vi.fn();
    const controller = new MutationTranslationController(document.body, onRoots);
    controller.start();

    const ui = document.createElement('div');
    ui.dataset.webTranslateUi = '';
    ui.textContent = 'Plugin tooltip';
    document.body.append(ui);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRoots).not.toHaveBeenCalled();

    controller.stop();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Late article text';
    document.body.append(paragraph);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRoots).not.toHaveBeenCalled();
  });

  it('上报直接新增的 Text 节点', async () => {
    document.body.innerHTML = '<main></main>';
    const onRoots = vi.fn();
    const controller = new MutationTranslationController(document.body, onRoots);
    controller.start();

    const text = document.createTextNode('Direct dynamic English');
    document.querySelector('main')!.append(text);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRoots).toHaveBeenCalledWith([text]);
    controller.stop();
  });
});
