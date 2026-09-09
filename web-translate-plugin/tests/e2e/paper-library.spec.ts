import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { extensionPath } from '../../playwright.config';

declare const chrome: {
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>> };
  scripting: { executeScript(details: { target: { tabId: number }; func: () => unknown }): Promise<Array<{ result?: unknown }>> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
};
let context: BrowserContext;
let options: Page;
let optionsUrl: string;
let copy: string;
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const pdf = await readFile(resolve(import.meta.dirname, '../../fixtures/probe.pdf'));
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/pdf'); res.end(pdf); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本地端口缺失');
  origin = `http://127.0.0.1:${address.port}`;
  // 独立临时扩展与 profile；预授予本机 fixture 权限，不代表 action Popup/原生权限验收。
  copy = await mkdtemp(resolve(tmpdir(), 'paper-library-e2e-'));
  await cp(extensionPath, copy, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(copy, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(resolve(copy, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  optionsUrl = `chrome-extension://${new URL(worker.url()).hostname}/options.html`;
  options = await context.newPage(); await options.goto(optionsUrl);
  await expect(options.locator('.dashboard-feedback')).toHaveText('本地记录已更新');
});
test.afterAll(async () => {
  await context?.close();
  if (server?.listening) await new Promise<void>((done) => server.close(() => done()));
  if (copy && resolve(copy).startsWith(resolve(tmpdir(), 'paper-library-e2e-'))) await rm(copy, { recursive: true, force: true });
});

test('最近阅读收藏、嵌套归类、搜索移动、刷新与清理隔离', async ({}, info) => {
  await options.evaluate(async (url) => {
    const db = await new Promise<IDBDatabase>((done, fail) => { const r = indexedDB.open('web-translate'); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
    await new Promise<void>((done, fail) => {
      const tx = db.transaction('history', 'readwrite');
      tx.objectStore('history').put({ id: 'pdf:library-e2e', kind: 'pdf', url, title: '论文原始标题', sourceLanguage: 'en', targetLanguage: 'zh', lastVisitedAt: Date.now(), lastPage: 2, pageCount: 3 });
      tx.oncomplete = () => done(); tx.onerror = () => fail(tx.error);
    }); db.close();
  }, `${origin}/history.pdf`);
  await options.reload();
  await options.getByRole('button', { name: '收藏论文', exact: true }).click();
  const dialog = options.getByRole('dialog');
  await dialog.getByLabel('收藏名称').fill('我的 Agent 论文');
  await dialog.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await dialog.getByLabel('新文件夹名称').fill('研究');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '文件夹', exact: true })).not.toHaveValue('');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await options.getByRole('button', { name: '论文库 收藏与文件夹' }).click();
  await expect(options.locator('.library-row')).toHaveCount(1);
  await options.getByRole('navigation', { name: '论文文件夹' }).getByRole('button', { name: '研究', exact: false }).click();
  await options.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await options.getByLabel('新文件夹名称').fill('Agent');
  await options.getByRole('button', { name: '保存文件夹' }).click();
  await options.getByRole('button', { name: '编辑收藏', exact: true }).click();
  await dialog.getByRole('combobox', { name: '文件夹', exact: true }).selectOption({ label: '研究 / Agent' });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(options.locator('.library-row')).toHaveCount(0);
  await options.getByRole('searchbox', { name: '搜索论文库' }).fill('Agent');
  await expect(options.locator('.library-row')).toHaveCount(1);
  await options.reload();
  await expect(options.locator('.library-row')).toHaveCount(1);
  await options.setViewportSize({ width: 375, height: 900 });
  await options.screenshot({ path: info.outputPath('library-mobile.png'), fullPage: true });
  expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await options.setViewportSize({ width: 1440, height: 1000 });
  await options.screenshot({ path: info.outputPath('library-desktop.png'), fullPage: true });
  const opened = context.waitForEvent('page');
  await options.getByRole('button', { name: '打开论文', exact: true }).click();
  const paper = await opened; await expect(paper).toHaveURL(`${origin}/history.pdf#page=2`); await paper.close();
  await options.getByRole('button', { name: '存储与隐私 本地数据管理' }).click();
  options.once('dialog', (d) => d.accept());
  await options.getByRole('button', { name: '清空历史', exact: true }).click();
  await expect(options.locator('.dashboard-feedback')).toHaveText('翻译历史已清空');
  options.once('dialog', (d) => d.accept());
  await options.getByRole('button', { name: '清空缓存', exact: true }).click();
  await expect(options.locator('.dashboard-feedback')).toHaveText('PDF 运行缓存已清空');
  await options.getByRole('button', { name: '论文库 收藏与文件夹' }).click();
  await expect(options.locator('.library-row')).toHaveCount(1);
  await options.getByRole('navigation', { name: '论文文件夹' }).getByRole('button', { name: '研究', exact: false }).first().click();
  await options.getByRole('button', { name: '重命名文件夹' }).click();
  await options.getByLabel('文件夹名称', { exact: true }).fill('我的研究');
  await options.getByRole('button', { name: '保存文件夹' }).click();
  options.once('dialog', (d) => d.accept());
  await options.getByRole('button', { name: '删除文件夹' }).click();
  await expect(options.locator('.library-row')).toHaveCount(0);
});

test('PDF 工作台星标收藏、重复编辑、默认目录与取消收藏（授权后路径）', async () => {
  await options.goto(`${optionsUrl}#library`);
  const pdf = await context.newPage(); await pdf.goto(`${origin}/workspace.pdf`);
  await pdf.bringToFront();
  const [tab] = await options.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
  const result = await options.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id! },
    func: () => chrome.runtime.sendMessage({ type: 'pdf-workspace:enable' }) }), tab.id);
  expect(result[0].result).toMatchObject({ ok: true, value: { enabled: true } });
  await expect(pdf.locator('.workspace-toolbar')).toBeVisible();
  await pdf.getByRole('button', { name: '收藏论文', exact: true }).click();
  const dialog = pdf.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '文件夹', exact: true })).toHaveValue('');
  await dialog.getByLabel('收藏名称').fill('PDF 星标收藏');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(pdf.getByRole('button', { name: '编辑收藏', exact: true })).toHaveText('★');
  await pdf.getByRole('button', { name: '编辑收藏', exact: true }).click();
  await expect(dialog.getByLabel('收藏名称')).toHaveValue('PDF 星标收藏');
  await dialog.getByLabel('收藏名称').fill('星标改名');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await options.reload(); await expect(options.locator('.library-row')).toHaveCount(1);
  await expect(options.locator('.library-row')).toContainText('星标改名');
  await pdf.getByRole('button', { name: '编辑收藏', exact: true }).click();
  await dialog.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(pdf.getByRole('button', { name: '收藏论文', exact: true })).toHaveText('☆');
  await options.reload(); await expect(options.locator('.library-row')).toHaveCount(0);
  await pdf.close();
});
