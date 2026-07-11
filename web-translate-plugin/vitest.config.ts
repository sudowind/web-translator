import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
