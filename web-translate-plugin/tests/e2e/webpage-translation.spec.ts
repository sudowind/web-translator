import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { extensionContextOptions, extensionPath } from '../../playwright.config';

test.describe('普通网页翻译授权后技术路径（不代表 action Popup / activeTab 权限 gate）', () => {
  let context: BrowserContext;
  let extensionPage: Page;
  let fixtureServer: Server;
  let origin: string;
  let authorizedExtensionPath: string;
  const requestBatches: string[][] = [];

  test.beforeAll(async () => {
    fixtureServer = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.url?.startsWith('/login')) {
        response.end('<!doctype html><html><body><input type="password"><p>Sensitive English</p></body></html>');
        return;
      }
      const below = Array.from(
        { length: 21 },
        (_, index) => `<p>Bottom English ${index + 1}</p>`,
      ).join('');
      response.end(`<!doctype html><html><head><style>
        .below{margin-top:1400px} #lead{font-family:Georgia,serif;font-size:19px;line-height:31px;color:rgb(32,58,77)}
        #lead strong{font-weight:700} #lead em{font-style:italic} #lead a{color:rgb(90,40,140)}
        html[data-theme="dark"] #lead{color:rgb(230,230,230)}
        </style></head><body>
        <main><h1 id="title">Article title</h1><p id="lead">Hello <strong>bold world</strong>, <em>read</em> <a href="#destination">the link</a>.</p>
        <ul id="list"><li>Parent item<ul><li>Nested item</li></ul></li></ul><blockquote><p id="quote">A quoted passage</p></blockquote>
        <button id="action">Add dynamic English</button><section class="below">${below}</section><div id="destination"></div></main>
        <script>
          window.clickCount = 0;
          window.linkCount = 0;
          document.querySelector('#lead a').addEventListener('click', () => { window.linkCount += 1; });
          document.querySelector('#action').addEventListener('click', () => {
            window.clickCount += 1;
            const node = document.createElement('p');
            node.id = 'dynamic';
            node.textContent = 'Dynamic English text';
            document.querySelector('main').append(node);
          });
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      fixtureServer.once('error', rejectListen);
      fixtureServer.listen(0, '127.0.0.1', resolveListen);
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('fixture server 未取得端口');
    origin = `http://127.0.0.1:${address.port}`;

    authorizedExtensionPath = await mkdtemp(`${tmpdir()}\\webpage-translation-authorized-`);
    await cp(extensionPath, authorizedExtensionPath, { recursive: true });
    const manifestPath = resolve(authorizedExtensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    manifest.host_permissions = [...(manifest.optional_host_permissions ?? [])];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    context = await chromium.launchPersistentContext('', {
      ...extensionContextOptions,
      args: [
        `--disable-extensions-except=${authorizedExtensionPath}`,
        `--load-extension=${authorizedExtensionPath}`,
      ],
    });
    await context.route('https://api.example.test/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON() as {
        messages: Array<{ content: string }>;
        response_format?: { type: string };
        stream?: boolean;
      };
      if (!body.response_format) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
        });
        return;
      }
      const request = JSON.parse(body.messages[1].content) as {
        blocks: Array<{ id: string; text: string }>;
      };
      requestBatches.push(request.blocks.map(({ text }) => text));
      const translations = request.blocks.map(({ id, text }) => ({
        id,
        text: text === 'Hello' ? '你好' : `译文：${text.trim()}`,
      }));
      expect(body.stream).toBe(true);
      const content = JSON.stringify({ translations });
      const middle = Math.floor(content.length / 2);
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [content.slice(0, middle), content.slice(middle)]
          .map((delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
          .join('') + 'data: [DONE]\n\n',
      });
    });

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
    await extensionPage.getByRole('button', { name: 'AI 服务 模型与智能体' }).click();
    await extensionPage.getByLabel('LLM 接口地址', { exact: true }).fill('https://api.example.test/v1');
    await extensionPage.getByLabel('默认模型', { exact: true }).fill('test-model');
    await extensionPage.getByLabel('LLM API Key', { exact: true }).fill('test-key');
    await extensionPage.getByRole('button', { name: '测试快速连通' }).click();
    await expect(extensionPage.getByText('测试成功', { exact: true })).toBeVisible();
    await extensionPage.getByRole('button', { name: '保存设置' }).click();
    await expect(extensionPage.getByText(/设置已保存/)).toBeVisible();
    requestBatches.length = 0;
  });

  test.afterAll(async () => {
    await context?.close();
    if (authorizedExtensionPath) {
      await rm(authorizedExtensionPath, { recursive: true, force: true });
    }
    if (fixtureServer?.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        fixtureServer.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  });

  test('语义块对照、计算样式、链接、动态更新和完整清理', async () => {
    requestBatches.length = 0;
    const page = await context.newPage();
    await page.goto(`${origin}/article`);
    const originalLead = await page.locator('#lead').innerHTML();
    const enabled = await sendAuthorizedCommand(page, 'webpage:enable');
    expect(enabled, JSON.stringify(enabled)).toMatchObject({ ok: true, value: { enabled: true } });
    const leadTranslation = page.locator('#lead > [data-web-translate-block]');
    await expect(leadTranslation).toHaveText('译文：Hello bold world, read the link.');
    await expect(page.locator('[data-web-translate-state="done"]')).toHaveCount(26);
    expect(requestBatches.flat().filter(text => text.includes('bold world'))).toHaveLength(1);
    expect(requestBatches[0][0]).toBe('Article title');
    await expect(leadTranslation.locator('strong')).toHaveText('bold world');
    await expect(leadTranslation.locator('em')).toHaveText('read');
    await expect(leadTranslation.locator('a')).toHaveAttribute('href', `${origin}/article#destination`);
    const styles = await page.locator('#lead').evaluate(element => {
      const translated = element.querySelector('[data-web-translate-block]')!;
      const properties = ['fontFamily', 'fontSize', 'color', 'lineHeight'] as const;
      const read = (node: Element) => properties.map(p => getComputedStyle(node)[p]);
      return { original: read(element), translated: read(translated),
        bold: getComputedStyle(translated.querySelector('strong')!).fontWeight,
        italic: getComputedStyle(translated.querySelector('em')!).fontStyle,
        link: getComputedStyle(translated.querySelector('a')!).color,
        originalLink: getComputedStyle(element.querySelector('a')!).color };
    });
    expect(styles.translated).toEqual(styles.original);
    expect(styles.bold).toBe('700'); expect(styles.italic).toBe('italic');
    expect(styles.link).toBe(styles.originalLink);
    const beforeTheme = requestBatches.length;
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect(leadTranslation).toHaveCSS('color', 'rgb(230, 230, 230)');
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await expect(leadTranslation).toHaveCSS('color', 'rgb(32, 58, 77)');
    expect(requestBatches.length).toBe(beforeTheme);
    await page.screenshot({ path: test.info().outputPath('bilingual-page.png') });
    expect(await page.locator('#lead').evaluate(element => {
      const clone = element.cloneNode(true) as Element;
      clone.querySelector('[data-web-translate-block]')!.remove();
      return clone.innerHTML;
    })).toBe(originalLead);
    await expect(page.locator('#list > li > [data-web-translate-block]')).toHaveText('译文：Parent item');
    await expect(page.locator('#list ul li > [data-web-translate-block]')).toHaveText('译文：Nested item');
    await leadTranslation.locator('a').click();
    await expect(page).toHaveURL(/#destination$/);
    await page.locator('#lead > a').click();
    expect(await page.evaluate(() => (window as unknown as { linkCount: number }).linkCount)).toBe(1);
    await page.locator('#action').click();
    await expect(page.locator('#dynamic > [data-web-translate-block]')).toHaveText('译文：Dynamic English text');
    expect(await page.evaluate(() => (window as unknown as { clickCount: number }).clickCount)).toBe(1);
    // A website changes an existing Text node, rather than appending a new element.
    await page.locator('#dynamic').evaluate(element => { element.firstChild!.textContent = 'Updated English text'; });
    await expect(page.locator('#dynamic > [data-web-translate-block]')).toHaveText('译文：Updated English text');
    await expect(page.locator('#dynamic > [data-web-translate-block]')).toHaveCount(1);
    await page.locator('#quote').evaluate(element => { element.replaceChildren(document.createTextNode('Replaced quote')); });
    await expect(page.locator('#quote > [data-web-translate-block]')).toHaveText('译文：Replaced quote');
    const requestCount = requestBatches.length;
    await sendAuthorizedCommand(page, 'webpage:enable');
    await page.locator('#dynamic').evaluate(element => { document.querySelector('main')!.prepend(element); });
    await expect(page.locator('main > #dynamic > [data-web-translate-block]')).toHaveText('译文：Updated English text');
    // Wait for observer debounce before checking request stability.
    await page.waitForTimeout(250);
    expect(requestBatches.length).toBe(requestCount);
    await page.locator('#quote').evaluate(element => element.remove());
    await expect(page.locator('#quote')).toHaveCount(0);
    const disabled = await sendAuthorizedCommand(page, 'webpage:disable');
    expect(disabled).toMatchObject({ ok: true, value: { enabled: false } });
    await expect(page.locator('[data-web-translate-block]')).toHaveCount(0);
    await expect(page.locator('[data-web-translate-style]')).toHaveCount(0);
    expect(await page.locator('#lead').innerHTML()).toBe(originalLead);
    await expect(page.locator('#dynamic')).toHaveText('Updated English text');
    await page.locator('#action').click();
    expect(await page.evaluate(() => (window as unknown as { clickCount: number }).clickCount)).toBe(2);
    await page.close();
  });

  test('敏感页面返回结构化不可启用状态', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/login`);
    const response = await sendAuthorizedCommand(page, 'webpage:enable');
    expect(response).toEqual({
      ok: true,
      value: { enabled: false, count: 0, reason: 'PAGE_NOT_ELIGIBLE' },
    });
    await expect(page.locator('p')).toHaveText('Sensitive English');
    await page.close();
  });

  async function sendAuthorizedCommand(page: Page, type: 'webpage:enable' | 'webpage:disable') {
    const tabId = await extensionPage.evaluate(async (url) => {
      const chromeApi = (globalThis as unknown as {
        chrome: { tabs: { query(query: { url: string }): Promise<Array<{ id?: number }>> } };
      }).chrome;
      const [tab] = await chromeApi.tabs.query({ url });
      if (tab.id === undefined) throw new Error('目标标签页缺少 id');
      return tab.id;
    }, page.url().split('#')[0]);
    if (type === 'webpage:enable') {
      await extensionPage.evaluate(async (id) => {
        const chromeApi = (globalThis as unknown as {
          chrome: {
            scripting: {
              executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
            };
          };
        }).chrome;
        await chromeApi.scripting.executeScript({
          target: { tabId: id },
          files: ['/content-scripts/webpage.js'],
        });
      }, tabId);
    }
    return extensionPage.evaluate(
      async ({ id, command }) => {
        const chromeApi = (globalThis as unknown as {
          chrome: { tabs: { sendMessage(tabId: number, message: unknown): Promise<unknown> } };
        }).chrome;
        return chromeApi.tabs.sendMessage(id, { type: command });
      },
      { id: tabId, command: type },
    );
  }
});
