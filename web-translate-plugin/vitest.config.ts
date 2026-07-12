import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    pool: 'threads',
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/live/**'],
  },
});
