import { chromium, expect, test } from '@playwright/test';
import { extensionContextOptions } from '../../playwright.config';

// 真实构建 UI + 固定状态数据；不代表原生 action Popup 或站点授权验收。
for (const eligible of [true, false]) {
  test(`弹窗展示与诊断折叠：${eligible ? 'PDF' : '网页'}`, async ({}, testInfo) => {
    const context = await chromium.launchPersistentContext('', { ...extensionContextOptions, headless: true });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      await page.setViewportSize({ width: 360, height: 600 });
      await page.addInitScript((pdf) => {
        const chrome = (globalThis as unknown as { chrome: {
          runtime: { sendMessage: (message: { type: string }) => Promise<unknown> };
          tabs: { query: () => Promise<unknown>; sendMessage: () => Promise<unknown> };
        } }).chrome;
        chrome.runtime.sendMessage = (async (message: { type: string }) => ({ ok: true, value:
          message.type.startsWith('pdf-workspace:') ? { eligible: pdf, enabled: false, url: 'https://arxiv.org/pdf/2401.00001' }
            : { bytesReadable: true, kind: 'arxiv' },
        })) as typeof chrome.runtime.sendMessage;
        chrome.tabs.query = (async () => [{ id: 1 }]) as typeof chrome.tabs.query;
        chrome.tabs.sendMessage = (async () => ({ ok: true, value: { enabled: false, count: 0 } })) as typeof chrome.tabs.sendMessage;
      }, eligible);
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
      await expect(page.getByRole('heading', { name: eligible ? 'PDF 对照阅读' : '网页对照翻译' })).toBeVisible();
      await expect(page.getByRole('button', { name: eligible ? '翻译此 PDF' : '翻译当前网页', exact: true })).toBeVisible();
      await expect(page.locator('pre')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      expect(await page.locator('main').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600);
      await page.screenshot({ path: testInfo.outputPath('popup.png'), fullPage: true });
      await page.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: '检查当前 PDF' })).toBeVisible();
      await expect(page.getByLabel('诊断详情')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page.locator('pre')).toBeHidden();
    } finally { await context.close(); }
  });
}
