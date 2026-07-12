import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 30 * 60 * 1000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
