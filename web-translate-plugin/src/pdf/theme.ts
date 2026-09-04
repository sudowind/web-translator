import React from 'react';

export const PDF_THEME_STORAGE_KEY = 'pdf-workspace-theme';

export type PdfThemePreference = 'system' | 'light' | 'dark';
export type ResolvedPdfTheme = 'light' | 'dark';

export function isPdfThemePreference(value: unknown): value is PdfThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolvePdfTheme(
  preference: PdfThemePreference,
  systemDark: boolean,
): ResolvedPdfTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function usePdfTheme() {
  const mediaQuery = React.useMemo(
    () => globalThis.matchMedia?.('(prefers-color-scheme: dark)'),
    [],
  );
  const [preference, setPreference] = React.useState<PdfThemePreference>('system');
  const [systemDark, setSystemDark] = React.useState(mediaQuery?.matches ?? false);
  const changedByUser = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void browser.storage.local.get(PDF_THEME_STORAGE_KEY).then((stored) => {
      const value = stored[PDF_THEME_STORAGE_KEY];
      if (!cancelled && !changedByUser.current && isPdfThemePreference(value)) setPreference(value);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!mediaQuery) return;
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mediaQuery]);

  React.useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const value = changes[PDF_THEME_STORAGE_KEY]?.newValue;
      if (isPdfThemePreference(value)) setPreference(value);
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const resolvedTheme = resolvePdfTheme(preference, systemDark);

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.pdfTheme = resolvedTheme;
    root.dataset.pdfThemePreference = preference;
    root.style.colorScheme = resolvedTheme;
    return () => {
      delete root.dataset.pdfTheme;
      delete root.dataset.pdfThemePreference;
      root.style.removeProperty('color-scheme');
    };
  }, [preference, resolvedTheme]);

  const changePreference = React.useCallback((next: PdfThemePreference) => {
    changedByUser.current = true;
    setPreference(next);
    void browser.storage.local.set({ [PDF_THEME_STORAGE_KEY]: next }).catch(() => undefined);
  }, []);

  return { preference, resolvedTheme, setPreference: changePreference } as const;
}
