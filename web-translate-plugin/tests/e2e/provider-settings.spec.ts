import { chromium, expect, test } from '@playwright/test';
import { extensionContextOptions } from '../../playwright.config';

test('独立配置 MinerU：保存、权限范围与重载持久化（模拟权限授予）', async () => {
  // 使用临时浏览器数据目录和真实扩展产物；模拟授权不替代原生权限弹窗验收。
  const context = await chromium.launchPersistentContext('', { ...extensionContextOptions, headless: true });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.addInitScript(() => {
      (window as any).__requestedOrigins = [];
      (window as any).chrome.permissions.request = async (permissions: { origins?: string[] }) => {
        (window as any).__requestedOrigins.push(permissions.origins);
        return true;
      };
    });
    const optionsUrl = `chrome-extension://${new URL(worker.url()).host}/options.html`;
    await page.goto(`${optionsUrl}#pdf`);
    await expect(page.locator('.feedback')).toContainText('设置已加载');
    await page.getByLabel('MinerU Token', { exact: true }).fill('mineru-test-token');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.feedback')).toContainText('设置已保存；翻译和论文问答需另行配置 LLM API Key');
    expect(await page.evaluate(() => (window as any).__requestedOrigins)).toEqual([
      ['https://mineru.net/*', 'https://cdn-mineru.openxlab.org.cn/*'],
    ]);
    await page.reload();
    await expect(page.getByLabel('MinerU Token', { exact: true })).toHaveValue('mineru-test-token');
    await page.getByRole('button', { name: 'AI 服务 模型与智能体' }).click();
    await expect(page.locator('#api-key')).toHaveValue('');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.feedback')).toContainText('设置已保存');
  } finally {
    await context.close();
  }
});
