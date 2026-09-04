import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { extensionContextOptions } from '../../playwright.config';

const sections = [
  ['history', '最近阅读'], ['providers', 'AI 服务'], ['translation', '翻译偏好'],
  ['pdf', 'PDF 解析'], ['storage', '存储与隐私'],
] as const;
const longTitle = '长标题阅读回归：UnderstandingLanguageModels_' + 'continuous-text-'.repeat(9);
const longHost = 'long-document-source-'.repeat(3) + '.example.test';
let context: BrowserContext;
let optionsUrl: string;

test.beforeAll(async () => {
  // 加载真实构建扩展，但使用全新的临时 profile；不读取用户已安装扩展。
  context = await chromium.launchPersistentContext('', { ...extensionContextOptions, headless: true });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  optionsUrl = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  const page = await context.newPage();
  await page.goto(optionsUrl);
  await expect(page.locator('.dashboard-feedback')).toHaveText('本地记录已更新');
  await page.evaluate(async ({ title, host }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('web-translate');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('history', 'readwrite');
      transaction.objectStore('history').put({ id: 'pdf:typography', kind: 'pdf', title,
        url: `https://${host}/paper.pdf`, sourceLanguage: 'en', targetLanguage: 'zh-CN',
        lastVisitedAt: Date.now(), lastPage: 120, pageCount: 999 });
      transaction.objectStore('history').put({ id: 'webpage:typography', kind: 'webpage',
        title: '网页阅读与设置示例', url: 'https://example.test/article',
        sourceLanguage: 'en', targetLanguage: 'zh-CN', lastVisitedAt: Date.now() - 1000 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, { title: longTitle, host: longHost });
  await page.close();
});

test.afterAll(async () => { await context?.close(); });

for (const width of [1440, 1024, 768, 375]) {
  for (const scale of [100, 200]) {
    test(`${width}px / ${scale}% 文本缩放：五分区可读且无溢出`, async ({}, testInfo) => {
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(optionsUrl);
        await expect(page.locator('.history-row')).toHaveCount(2);
        // 这是根字号文本缩放，不是 Chrome 原生页面缩放。
        await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%`; }, scale);
        for (const [id, name] of sections) {
          await page.getByRole('button', { name, exact: false }).first().click();
          await expect(page).toHaveURL(new RegExp(`#${id}$`));
          if (['providers', 'translation', 'pdf'].includes(id)) {
            await expect(page.locator('.feedback')).toHaveText('状态：设置已加载');
          }
          await page.screenshot({ path: testInfo.outputPath(`${id}-${width}-text-${scale}.png`), fullPage: true });
          await checkLayout(page, scale);
          if (id === 'history') {
            await expect(page.locator('.history-main h2').first()).toHaveText(longTitle);
            await expect(page.locator('.reading-progress small')).toHaveText('第 120 / 999 页');
          }
        }
      } finally { await page.close(); }
    });
  }
}

test('200% 文本缩放下搜索、筛选、键盘导航及表单校验可操作', async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(optionsUrl);
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.getByRole('searchbox', { name: '搜索历史' }).fill('不存在的记录');
    await expect(page.locator('.empty-state h2')).toHaveText('还没有翻译记录');
    await checkLayout(page, 200);
    await page.getByRole('searchbox').fill(longHost);
    await expect(page.locator('.history-row')).toHaveCount(1);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('button', { name: '网页', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(1);
    await expect(page.locator('.history-main h2')).toHaveText('网页阅读与设置示例');

    const aiNav = page.getByRole('button', { name: 'AI 服务 模型与智能体' });
    await aiNav.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#providers$/);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveClass('nav-item');
    await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
    await expect(page.locator('.feedback')).toHaveText('状态：设置已加载');
    await page.getByLabel('LLM 接口地址', { exact: true }).fill(`https://${longHost}/v1`);
    await page.getByLabel('默认模型', { exact: true }).fill('typography-test-model');
    // 先检查原生必填校验，再使用空白字符触发应用内校验。
    // 不提供实际 API Key，不申请原生权限、不发送模型请求。
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('#api-key:invalid')).toBeFocused();
    await page.getByLabel('LLM API Key', { exact: true }).fill(' ');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.feedback')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#api-key')).toHaveAttribute('aria-invalid', 'true');
    await checkLayout(page, 200);
    await page.getByRole('button', { name: '翻译偏好 语言与响应速度' }).click();
    await page.getByLabel('译文语言').fill('ja');
    await expect(page.getByLabel('译文语言')).toHaveValue('ja');
    await page.getByRole('button', { name: 'PDF 解析 MinerU 服务' }).click();
    await page.getByLabel('MinerU 模型版本').selectOption('pipeline');
    await expect(page.getByLabel('MinerU 模型版本')).toHaveValue('pipeline');
    await checkLayout(page, 200);
  } finally { await page.close(); }
});

async function checkLayout(page: Page, scale: number) {
  const problems = await page.evaluate((scalePercent) => {
    const failures: string[] = [];
    const rgba = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map((channel) => {
      const normalized = channel / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const background = (element: Element): number[] => {
      const color = rgba(getComputedStyle(element).backgroundColor);
      const alpha = color[3] ?? 1;
      const parent = alpha < 1 && element.parentElement ? background(element.parentElement) : [255, 255, 255];
      return color.slice(0, 3).map((channel, index) => channel * alpha + parent[index] * (1 - alpha));
    };
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1) failures.push('document horizontal overflow');
    const nodes = [...document.querySelectorAll<HTMLElement>('.dashboard-shell *')];
    for (const node of nodes) {
      if (node.closest('.visually-hidden, [aria-hidden="true"]') || node.tagName === 'OPTION') continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || style.visibility === 'hidden') continue;
      const label = `${node.tagName}.${node.className}: ${node.textContent?.trim().slice(0, 45)}`;
      if (rect.left < -1 || rect.right > viewport + 1) failures.push(`bounds ${label}`);
      const hasText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      if (hasText && parseFloat(style.fontSize) < 14 * scalePercent / 100 - .1) failures.push(`small text ${style.fontSize} ${label}`);
      if (hasText && !node.closest(':disabled')) {
        const fg = luminance(rgba(style.color));
        const bg = luminance(background(node));
        const contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
        if (contrast < 4.5) failures.push(`low contrast ${contrast.toFixed(2)} ${label}`);
      }
      if (node.matches('button, input:not([type="checkbox"]), select')) {
        if (parseFloat(style.fontSize) < 16 * scalePercent / 100 - .1) failures.push(`small control ${label}`);
        if (rect.height < 44 * scalePercent / 100 - 1) failures.push(`short control ${label}`);
      }
      // 文本输入框可在内部滚动；其他正文与按钮不得裁切文字。
      if (!node.matches('input, select') && node.scrollWidth > node.clientWidth + 2 && style.overflowX !== 'visible') {
        failures.push(`clipped text ${label}`);
      }
      if (node.matches('button, label, legend, h1, h2, p, small') && node.scrollHeight > node.clientHeight + 2) {
        failures.push(`vertical text overflow ${node.scrollHeight}/${node.clientHeight} ${label}`);
      }
    }
    return failures;
  }, scale);
  expect(problems).toEqual([]);
}
