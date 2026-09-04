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
      response.end(`<!doctype html><html><head><style>.below{margin-top:1400px}</style></head><body>
        <main><p id="lead">Hello world</p><button id="action">Add dynamic English</button><section class="below">${below}</section></main>
        <script>
          window.clickCount = 0;
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

  test('静态与动态文本原位翻译、首屏优先、查看原文、事件保留并完整恢复', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/article`);
    const enabled = await sendAuthorizedCommand(page, 'webpage:enable');
    expect(enabled, JSON.stringify(enabled)).toMatchObject({ ok: true, value: { enabled: true } });

    await expect(page.locator('#lead')).toHaveText('译文：Hello world');
    expect(requestBatches[0].slice(0, 2)).toEqual([
      'Hello world',
      'Add dynamic English',
    ]);
    expect(await page.locator('#lead').getAttribute('data-web-translate-original')).toBe(
      'Hello world',
    );
    await page.locator('#lead').hover();
    expect(
      await page.locator('#lead').evaluate((element) =>
        getComputedStyle(element, '::after').content,
      ),
    ).toContain('Hello world');

    await page.locator('#action').click();
    await expect(page.locator('#dynamic')).toHaveText('译文：Dynamic English text');
    expect(await page.evaluate(() => (window as unknown as { clickCount: number }).clickCount)).toBe(1);

    const disabled = await sendAuthorizedCommand(page, 'webpage:disable');
    expect(disabled).toMatchObject({ ok: true, value: { enabled: false } });
    await expect(page.locator('#lead')).toHaveText('Hello world');
    await expect(page.locator('#action')).toHaveText('Add dynamic English');
    await expect(page.locator('#dynamic')).toHaveText('Dynamic English text');
    expect(await page.locator('[data-web-translate-original]').count()).toBe(0);

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
    }, page.url());
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
