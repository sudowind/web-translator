import { describe, expect, it } from 'vitest';

import {
  isPdfThemePreference,
  resolvePdfTheme,
  type PdfThemePreference,
} from '../../../src/pdf/theme';

describe('PDF 工作台主题', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] satisfies Array<[PdfThemePreference, boolean, 'light' | 'dark']>)(
    '%s 偏好在系统深色=%s 时解析为 %s',
    (preference, systemDark, expected) => {
      expect(resolvePdfTheme(preference, systemDark)).toBe(expected);
    },
  );

  it('只接受三种持久化偏好', () => {
    expect(isPdfThemePreference('system')).toBe(true);
    expect(isPdfThemePreference('light')).toBe(true);
    expect(isPdfThemePreference('dark')).toBe(true);
    expect(isPdfThemePreference('sepia')).toBe(false);
    expect(isPdfThemePreference(undefined)).toBe(false);
  });
});
