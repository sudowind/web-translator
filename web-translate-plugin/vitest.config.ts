import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    // Windows 下隔离 PDF.js 的原生 Canvas 依赖，避免线程池偶发无诊断退出。
    pool: process.platform === 'win32' ? 'forks' : 'threads',
    maxWorkers: 4,
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/live/**'],
  },
});
