import { expect, it } from 'vitest';

import { OperationEpoch } from '../../../src/pdf/operation-epoch';

it('清缓存推进 epoch 后旧异步结果不能回填 UI', () => {
  const epoch = new OperationEpoch();
  const old = epoch.current();
  epoch.advance();
  expect(epoch.isCurrent(old)).toBe(false);
  expect(epoch.isCurrent(epoch.current())).toBe(true);
});
