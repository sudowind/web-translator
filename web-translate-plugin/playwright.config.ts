import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));

export const extensionPath = resolve(projectDir, '.output/chrome-mv3');

export const extensionContextOptions = {
  channel: 'chromium' as const,
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--allow-file-access-from-files',
  ],
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
});
