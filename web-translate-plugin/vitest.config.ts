import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 3,
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/live/**'],
  },
});
