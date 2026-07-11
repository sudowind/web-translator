import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { TakeoverProbeResult } from '../../../src/pdf-takeover/contracts';
import {
  getLatestProbeResult,
  saveProbeResult,
} from '../../../src/pdf-takeover/report-store';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('探针报告存储', () => {
  it('初始值为 null', async () => {
    await expect(getLatestProbeResult()).resolves.toBeNull();
  });

  it('保存后完整读回报告', async () => {
    const result: TakeoverProbeResult = {
      tabId: 7,
      originalUrl: 'https://example.com/paper.pdf?x=1#page=2',
      finalUrl: 'https://example.com/paper.pdf?x=1#page=2',
      kind: 'remote',
      injected: true,
      rendererVerified: true,
      bytesReadable: true,
      restored: true,
      passed: true,
      measuredAt: '2026-07-11T08:00:00.000Z',
    };

    await saveProbeResult(result);

    await expect(getLatestProbeResult()).resolves.toEqual(result);
  });
});
