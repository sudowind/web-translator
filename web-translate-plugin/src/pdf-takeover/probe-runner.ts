import type { PdfTargetKind, TakeoverProbeResult } from './contracts';

export interface TabInput {
  id: number;
  url: string;
}

export interface ProbeDeps {
  classify(url: string): PdfTargetKind | null;
  mount(tabId: number): Promise<{ href: string; injected: boolean }>;
  readBytes(url: string): Promise<boolean>;
  restore(tabId: number): Promise<boolean>;
}

export async function runTakeoverProbe(
  deps: ProbeDeps,
  tab: TabInput,
): Promise<TakeoverProbeResult> {
  const measuredAt = new Date().toISOString();
  const kind = deps.classify(tab.url);

  if (kind === null) {
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: tab.url,
      injected: false,
      bytesReadable: false,
      restored: false,
      passed: false,
      failure: 'not_pdf',
      measuredAt,
    };
  }

  let mounted: { href: string; injected: boolean };

  try {
    mounted = await deps.mount(tab.id);
  } catch (error) {
    let restored = false;
    try {
      restored = await deps.restore(tab.id);
    } catch {
      // 保留 mount 的主要失败信息，同时已完成尽力恢复。
    }
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: tab.url,
      kind,
      injected: false,
      bytesReadable: false,
      restored,
      passed: false,
      failure: 'script_injection_blocked',
      detail: error instanceof Error ? error.message : String(error),
      measuredAt,
    };
  }

  if (!mounted.injected) {
    let restored = false;
    try {
      restored = await deps.restore(tab.id);
    } catch {
      // 保留脚本注入失败码，同时已完成尽力恢复。
    }
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: mounted.href,
      kind,
      injected: false,
      bytesReadable: false,
      restored,
      passed: false,
      failure: 'script_injection_blocked',
      measuredAt,
    };
  }

  if (mounted.href !== tab.url) {
    const restored = await deps.restore(tab.id);
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: mounted.href,
      kind,
      injected: true,
      bytesReadable: false,
      restored,
      passed: false,
      failure: 'url_changed',
      measuredAt,
    };
  }

  const bytesReadable = await deps.readBytes(tab.url);
  if (!bytesReadable) {
    const restored = await deps.restore(tab.id);
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: mounted.href,
      kind,
      injected: true,
      bytesReadable: false,
      restored,
      passed: false,
      failure: 'bytes_unreadable',
      measuredAt,
    };
  }

  const restored = await deps.restore(tab.id);
  if (!restored) {
    return {
      tabId: tab.id,
      originalUrl: tab.url,
      finalUrl: mounted.href,
      kind,
      injected: true,
      bytesReadable: true,
      restored: false,
      passed: false,
      failure: 'restore_failed',
      measuredAt,
    };
  }

  return {
    tabId: tab.id,
    originalUrl: tab.url,
    finalUrl: mounted.href,
    kind,
    injected: true,
    bytesReadable: true,
    restored: true,
    passed: true,
    measuredAt,
  };
}
