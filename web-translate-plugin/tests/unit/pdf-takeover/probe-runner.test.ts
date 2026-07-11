import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfTargetKind } from '../../../src/pdf-takeover/contracts';
import { runTakeoverProbe } from '../../../src/pdf-takeover/probe-runner';
import {
  mountProbeSurface,
  restoreProbeSurface,
} from '../../../src/pdf-takeover/takeover-dom';

const originalUrl = 'https://example.com/paper.pdf?x=1#page=2';

function createDeps() {
  return {
    classify: vi.fn<(url: string) => PdfTargetKind | null>(() => 'remote'),
    mount: vi.fn(async () => ({ href: originalUrl, injected: true })),
    readBytes: vi.fn(async () => true),
    restore: vi.fn(async () => true),
  };
}

describe('runTakeoverProbe', () => {
  it('URL 缺少 Fragment 时判定为 url_changed', async () => {
    const deps = createDeps();
    deps.mount.mockResolvedValue({
      href: 'https://example.com/paper.pdf?x=1',
      injected: true,
    });
    deps.restore.mockResolvedValue(false);

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({
      tabId: 7,
      originalUrl,
      finalUrl: 'https://example.com/paper.pdf?x=1',
      passed: false,
      failure: 'url_changed',
    });
    expect(deps.restore).toHaveBeenCalledWith(7);
  });

  it('所有依赖成功且 URL 逐字一致时通过', async () => {
    const deps = createDeps();

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({
      tabId: 7,
      originalUrl,
      finalUrl: originalUrl,
      kind: 'remote',
      injected: true,
      bytesReadable: true,
      restored: true,
      passed: true,
    });
    expect(result.failure).toBeUndefined();
    expect(new Date(result.measuredAt).toISOString()).toBe(result.measuredAt);
  });

  it('分类为 null 时不调用后续依赖', async () => {
    const deps = createDeps();
    deps.classify.mockReturnValue(null);

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({ passed: false, failure: 'not_pdf' });
    expect(result.kind).toBeUndefined();
    expect(deps.mount).not.toHaveBeenCalled();
    expect(deps.readBytes).not.toHaveBeenCalled();
    expect(deps.restore).not.toHaveBeenCalled();
  });

  it('mount 抛错时返回 script_injection_blocked 与字符串 detail', async () => {
    const deps = createDeps();
    deps.mount.mockRejectedValue(new Error('脚本注入被阻止'));

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({
      passed: false,
      failure: 'script_injection_blocked',
      detail: '脚本注入被阻止',
    });
    expect(deps.readBytes).not.toHaveBeenCalled();
    expect(deps.restore).not.toHaveBeenCalled();
  });

  it('字节不可读时返回 bytes_unreadable', async () => {
    const deps = createDeps();
    deps.readBytes.mockResolvedValue(false);
    deps.restore.mockResolvedValue(false);

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({
      bytesReadable: false,
      passed: false,
      failure: 'bytes_unreadable',
    });
    expect(deps.restore).toHaveBeenCalledWith(7);
  });

  it('恢复失败时返回 restore_failed', async () => {
    const deps = createDeps();
    deps.restore.mockResolvedValue(false);

    const result = await runTakeoverProbe(deps, { id: 7, url: originalUrl });

    expect(result).toMatchObject({
      restored: false,
      passed: false,
      failure: 'restore_failed',
    });
  });
});

describe('探针 DOM 接管与恢复', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/paper.pdf?x=1#page=2');
    document.documentElement.innerHTML =
      '<head><title>原页面</title></head><body><p>原 DOM 文本</p></body>';
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('挂载 PDF.js 探针界面且不改变 location.href', () => {
    const href = location.href;

    const result = mountProbeSurface();

    expect(result).toEqual({ href, injected: true });
    expect(
      document.querySelector('[data-renderer="pdfjs-probe"]'),
    ).not.toBeNull();
    expect(location.href).toBe(href);
  });

  it('恢复原 DOM 文本并清除 sessionStorage 标记', () => {
    mountProbeSurface();

    expect(restoreProbeSurface()).toBe(true);
    expect(document.body.textContent).toContain('原 DOM 文本');
    expect(sessionStorage.getItem('web-translate:probe:previous')).toBeNull();
  });
});
