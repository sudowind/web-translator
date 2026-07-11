import { describe, expect, it } from 'vitest';

import { isPdfProbeMessage } from '../../../src/pdf-takeover/messages';

describe('isPdfProbeMessage', () => {
  it('接受已知消息与合法 restore tabId', () => {
    expect(isPdfProbeMessage({ type: 'pdf-probe:run' })).toBe(true);
    expect(isPdfProbeMessage({ type: 'pdf-probe:latest' })).toBe(true);
    expect(isPdfProbeMessage({ type: 'pdf-probe:restore' })).toBe(true);
    expect(isPdfProbeMessage({ type: 'pdf-probe:restore', tabId: 0 })).toBe(true);
    expect(isPdfProbeMessage({ type: 'pdf-probe:restore', tabId: 7 })).toBe(true);
  });

  it.each(['7', -1, 1.5, Number.NaN])('拒绝非法 restore tabId：%s', (tabId) => {
    expect(isPdfProbeMessage({ type: 'pdf-probe:restore', tabId })).toBe(false);
  });

  it('拒绝未知消息与非对象输入', () => {
    expect(isPdfProbeMessage({ type: 'pdf-probe:unknown' })).toBe(false);
    expect(isPdfProbeMessage(null)).toBe(false);
  });
});
