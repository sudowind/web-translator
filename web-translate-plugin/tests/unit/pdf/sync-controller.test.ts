import { describe, expect, it, vi } from 'vitest';

import { SyncController } from '../../../src/pdf/sync-controller';

describe('双栏同步控制器', () => {
  it('没有用户意图时忽略内容回填产生的可见页变化', () => {
    const navigate = vi.fn();
    const controller = new SyncController(navigate);
    controller.onVisible('translation', 4, 0.8);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('只允许当前用户驱动栏同步另一栏并在操作结束后停止', () => {
    const navigate = vi.fn();
    const controller = new SyncController(navigate);
    controller.beginUserScroll('pdf');
    controller.onVisible('pdf', 3, 0.4);
    controller.onVisible('translation', 3, 0.4);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('translation', 3, 0.4);
    controller.endUserScroll('pdf');
    controller.onVisible('pdf', 4, 0.1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('显式页码导航同时定位两栏且不留下滚动驱动状态', () => {
    const navigate = vi.fn();
    const controller = new SyncController(navigate);
    controller.beginUserScroll('translation');
    controller.navigateToPage(5);
    expect(navigate).toHaveBeenCalledWith('pdf', 5, 0);
    expect(navigate).toHaveBeenCalledWith('translation', 5, 0);
    navigate.mockClear();
    controller.onVisible('translation', 5, 0.3);
    expect(navigate).not.toHaveBeenCalled();
  });
});
