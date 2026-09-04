import { describe, expect, it, vi } from 'vitest';
import { PdfAutoResumeController } from '../../../src/pdf/auto-resume';

const url = 'https://x.test/p.pdf';
const saved = { enabled: true, page: 40, progress: 0.2, scale: 1.1, updatedAt: 1 };
function setup() {
  const store = { get: vi.fn().mockResolvedValue(saved) };
  const port = { getTab: vi.fn().mockResolvedValue({ url }), status: vi.fn().mockResolvedValue(false), mountRemembered: vi.fn().mockResolvedValue(true) };
  return { store, port, controller: new PdfAutoResumeController(store, port) };
}

describe('PDF 自动恢复控制器', () => {
  it('新 worker 从持久状态恢复；已挂载不重复注入', async () => {
    const { controller, port } = setup();
    await controller.restore(1, url);
    expect(port.mountRemembered).toHaveBeenCalledWith(1, url);
    port.status.mockResolvedValue(true);
    await controller.restore(1, url);
    expect(port.mountRemembered).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'missing', 'navigated', 'incognito'])('%s 时不自动挂载', async (kind) => {
    const { controller, port, store } = setup();
    if (kind === 'disabled') store.get.mockResolvedValue({ ...saved, enabled: false });
    if (kind === 'missing') store.get.mockResolvedValue(null);
    if (kind === 'navigated') port.getTab.mockResolvedValue({ url: 'https://x.test/other.pdf' });
    if (kind === 'incognito') port.getTab.mockResolvedValue({ url, incognito: true });
    await controller.restore(1, url);
    expect(port.mountRemembered).not.toHaveBeenCalled();
  });

  it('导航/关闭使异步读取中的恢复失效', async () => {
    const { controller, port, store } = setup();
    let release!: (value: typeof saved) => void;
    store.get.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = controller.restore(1, url);
    await Promise.resolve();
    controller.invalidate(1);
    release(saved);
    await pending;
    expect(port.mountRemembered).not.toHaveBeenCalled();
  });

  it('注入与关闭串行，权限失败不阻塞后续手动操作', async () => {
    const { controller, port } = setup();
    port.mountRemembered.mockRejectedValue(new Error('permission denied'));
    await expect(controller.restore(1, url)).rejects.toThrow('permission denied');
    const close = vi.fn().mockResolvedValue(undefined);
    await controller.serialize(1, close);
    expect(close).toHaveBeenCalledOnce();
  });
});
