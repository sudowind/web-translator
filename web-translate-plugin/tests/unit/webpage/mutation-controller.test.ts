// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MutationTranslationController } from '../../../src/webpage/mutation-controller';
let controller: MutationTranslationController;
afterEach(() => { controller?.stop(); vi.useRealTimers(); });
it('合并新增、文本、属性和删除事件，忽略自有插入，停止后清理待执行回调', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<p>Hello</p>';
  const callback = vi.fn();
  controller = new MutationTranslationController(document.body, callback); controller.start();
  document.querySelector('p')!.firstChild!.textContent = 'Updated';
  document.querySelector('p')!.setAttribute('class', 'changed');
  const node = document.createElement('p'); node.textContent = 'Added'; document.body.append(node);
  await vi.advanceTimersByTimeAsync(90); expect(callback).toHaveBeenCalledTimes(1);
  const own = document.createElement('span'); own.dataset.webTranslateUi = ''; document.body.append(own);
  await vi.advanceTimersByTimeAsync(90); expect(callback).toHaveBeenCalledTimes(1);
  node.remove(); await Promise.resolve(); controller.stop();
  await vi.advanceTimersByTimeAsync(90); expect(callback).toHaveBeenCalledTimes(1);
});
