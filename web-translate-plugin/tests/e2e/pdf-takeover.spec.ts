import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionContextOptions, extensionPath } from '../../playwright.config';

interface ProbeResult {
  tabId: number;
  originalUrl: string;
  finalUrl: string;
  injected: boolean;
  rendererVerified: boolean;
  bytesReadable: boolean;
  restored: boolean;
  passed: boolean;
}

test.describe('PDF.js 授权后技术矩阵（不代表生产权限 gate）', () => {
  let context: BrowserContext;
  let extensionPage: Page;
  let testExtensionPath: string;
  let fixtureServer: Server;
  let httpOrigin: string;

  test.beforeAll(async () => {
    const fixtureBytes = await readFile(resolve(import.meta.dirname, '../../fixtures/probe.pdf'));
    fixtureServer = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/redirect') {
        response.statusCode = 302;
        response.setHeader('Location', '/protected.pdf?source=redirect');
        response.end();
        return;
      }

      if (requestUrl.pathname === '/cookie.pdf' &&
          !request.headers.cookie?.split(';').map((value) => value.trim()).includes('session=probe-ok')) {
        response.statusCode = 401;
        response.end('session cookie required');
        return;
      }

      if (requestUrl.pathname === '/protected.pdf' || requestUrl.pathname === '/cookie.pdf') {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Length', fixtureBytes.length);
        response.end(fixtureBytes);
        return;
      }

      if (requestUrl.pathname === '/landing') {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>导航中间页</title>');
        return;
      }

      response.statusCode = 404;
      response.end('not found');
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      fixtureServer.once('error', rejectListen);
      fixtureServer.listen(0, '127.0.0.1', resolveListen);
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('本地 fixture server 未取得 TCP 端口');
    httpOrigin = `http://127.0.0.1:${address.port}`;

    testExtensionPath = await mkdtemp(`${tmpdir()}\\pdf-takeover-authorized-`);
    await cp(extensionPath, testExtensionPath, { recursive: true });
    const manifestPath = resolve(testExtensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    manifest.host_permissions = [...(manifest.optional_host_permissions ?? [])];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    context = await chromium.launchPersistentContext('', {
      ...extensionContextOptions,
      args: [
        `--disable-extensions-except=${testExtensionPath}`,
        `--load-extension=${testExtensionPath}`,
        '--allow-file-access-from-files',
      ],
    });
    await context.addCookies([{ name: 'session', value: 'probe-ok', url: httpOrigin }]);
    const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
  });

  test.afterAll(async () => {
    await context?.close();
    if (testExtensionPath) {
      await rm(testExtensionPath, { recursive: true, force: true });
    }
    if (fixtureServer?.listening) {
      await new Promise<void>((resolveClose, rejectClose) => {
        fixtureServer.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  const localFixtureUrl = pathToFileURL(
    resolve(import.meta.dirname, '../../fixtures/probe.pdf'),
  ).href;

  async function runAuthorizedProbe(pdfPage: Page): Promise<ProbeResult> {
    await pdfPage.bringToFront();
    const response = await extensionPage.evaluate(async () => {
      const chrome = (globalThis as typeof globalThis & {
        chrome: {
          runtime: {
            sendMessage(message: unknown): Promise<
              | { ok: true; value: ProbeResult }
              | { ok: false; error: string }
            >;
          };
        };
      }).chrome;
      return chrome.runtime.sendMessage({ type: 'pdf-probe:run' });
    });
    if (!response.ok) throw new Error(response.error);
    return response.value;
  }

  function expectPassed(result: ProbeResult, originalUrl: string) {
    expect(result.originalUrl).toBe(originalUrl);
    expect(result.finalUrl).toBe(originalUrl);
    expect(result.injected, JSON.stringify(result)).toBe(true);
    expect(result.rendererVerified, JSON.stringify(result)).toBe(true);
    expect(result.bytesReadable, JSON.stringify(result)).toBe(true);
    expect(result.restored, JSON.stringify(result)).toBe(true);
    expect(result.passed, JSON.stringify(result)).toBe(true);
  }

  for (const sample of [
    {
      name: 'arXiv PDF 保留 query/fragment 语义',
      targetUrl: () => 'https://arxiv.org/pdf/2401.00001#page=2',
    },
    {
      name: '本地 file PDF 使用绝对 URL @future-file-diagnostic',
      targetUrl: () => localFixtureUrl,
    },
    {
      name: '302 重定向后的 PDF 保留 query/fragment',
      targetUrl: () => `${httpOrigin}/redirect?token=probe#page=3`,
    },
    {
      name: '携带 session Cookie 读取受保护 PDF',
      targetUrl: () => `${httpOrigin}/cookie.pdf?scope=private#page=1`,
    },
  ]) {
    test(sample.name, async () => {
      const pdfPage = await context.newPage();
      await pdfPage.goto(sample.targetUrl(), { waitUntil: 'domcontentloaded' });
      const originalUrl = pdfPage.url();
      const result = await runAuthorizedProbe(pdfPage);
      expectPassed(result, originalUrl);
      expect(pdfPage.url()).toBe(originalUrl);

      await pdfPage.close();
    });
  }

  test('刷新、历史导航、复制标签和新标签保持 URL 并可重新启用', async () => {
    const originalUrl = `${httpOrigin}/protected.pdf?source=semantics#page=1`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(originalUrl, { waitUntil: 'domcontentloaded' });
    expectPassed(await runAuthorizedProbe(pdfPage), originalUrl);

    await pdfPage.reload({ waitUntil: 'domcontentloaded' });
    expect(pdfPage.url()).toBe(originalUrl);
    const refreshed = await runAuthorizedProbe(pdfPage);
    expectPassed(refreshed, originalUrl);

    await pdfPage.goto(`${httpOrigin}/landing`);
    await pdfPage.goBack({ waitUntil: 'domcontentloaded' });
    expect(pdfPage.url()).toBe(originalUrl);
    expectPassed(await runAuthorizedProbe(pdfPage), originalUrl);
    await pdfPage.goForward();
    expect(pdfPage.url()).toBe(`${httpOrigin}/landing`);
    await pdfPage.goBack({ waitUntil: 'domcontentloaded' });
    expect(pdfPage.url()).toBe(originalUrl);

    const duplicatePromise = context.waitForEvent('page');
    await extensionPage.evaluate(async (tabId) => {
      const chromeApi = (globalThis as typeof globalThis & {
        chrome: { tabs: { duplicate(id: number): Promise<unknown> } };
      }).chrome;
      await chromeApi.tabs.duplicate(tabId);
    }, refreshed.tabId);
    const duplicatePage = await duplicatePromise;
    await duplicatePage.waitForLoadState('domcontentloaded');
    expect(duplicatePage.url()).toBe(originalUrl);
    expectPassed(await runAuthorizedProbe(duplicatePage), originalUrl);

    const newPage = await context.newPage();
    await newPage.goto(originalUrl, { waitUntil: 'domcontentloaded' });
    expect(newPage.url()).toBe(originalUrl);
    expectPassed(await runAuthorizedProbe(newPage), originalUrl);

    await Promise.all([pdfPage.close(), duplicatePage.close(), newPage.close()]);
  });
});
