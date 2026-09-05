// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { PDF_THEME_STORAGE_KEY, usePdfTheme } from '../../../src/pdf/theme';

function installMatchMedia(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() { return dark; },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return {
    setDark(next: boolean) {
      dark = next;
      const event = { matches: next, media: media.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeHarness() {
  const theme = usePdfTheme();
  return (
    <button type="button" onClick={() => theme.setPreference('dark')}>
      {theme.preference}/{theme.resolvedTheme}
    </button>
  );
}

describe('PDF 工作台主题同步', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.stubGlobal('browser', fakeBrowser);
    delete document.documentElement.dataset.pdfTheme;
    delete document.documentElement.dataset.pdfThemePreference;
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('跟随系统实时变化，手动选择后持久化并停止跟随', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const media = installMatchMedia(false);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<ThemeHarness />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe('system/light');
    expect(document.documentElement.dataset.pdfTheme).toBe('light');

    await act(async () => media.setDark(true));
    expect(container.textContent).toBe('system/dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    await act(async () => container.querySelector('button')!.click());
    expect(container.textContent).toBe('dark/dark');
    expect(await fakeBrowser.storage.local.get(PDF_THEME_STORAGE_KEY)).toEqual({
      [PDF_THEME_STORAGE_KEY]: 'dark',
    });

    await act(async () => media.setDark(false));
    expect(container.textContent).toBe('dark/dark');

    await act(async () => root.unmount());
    expect(document.documentElement.dataset.pdfTheme).toBeUndefined();
  });
});
