import { describe, expect, it, vi } from 'vitest';

import { SyncController } from '../../../src/pdf/sync-controller';

describe('双栏同步控制器', () => {
  it('同步页号与页内相对进度并阻止程序滚动反馈环', () => {
    const navigate = vi.fn();
    const controller = new SyncController(navigate);
    controller.onVisible('pdf', 3, 0.4);
    expect(navigate).toHaveBeenCalledWith('translation', 3, 0.4);
    controller.onVisible('translation', 3, 0.4);
    expect(navigate).toHaveBeenCalledOnce();
    controller.release('translation');
    controller.onVisible('translation', 4, 0.2);
    expect(navigate).toHaveBeenLastCalledWith('pdf', 4, 0.2);
  });

  it('用户滚动可立即接管并 navigateToPage 同时定位两栏', () => {
    const navigate = vi.fn();
    const controller = new SyncController(navigate);
    controller.suspend('translation');
    controller.userScroll('translation');
    controller.onVisible('translation', 2, 0.5);
    controller.navigateToPage(5);
    expect(navigate).toHaveBeenCalledWith('pdf', 2, 0.5);
    expect(navigate).toHaveBeenCalledWith('pdf', 5, 0);
    expect(navigate).toHaveBeenCalledWith('translation', 5, 0);
  });
});
