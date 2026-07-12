import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      func: () => unknown;
    }): Promise<Array<{ result?: unknown }>>;
  };
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>>;
  };
};

const extensionPath = resolve('.output/chrome-mv3');

function createTwoPagePdf(label = 'Public'): Buffer {
  const streams = [
    `BT /F1 18 Tf 72 720 Td (Page One - ${label}) Tj ET`,
    'BT /F1 18 Tf 72 720 Td (Page Two - Main Contribution) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

test.describe('PDF 工作台最终验收（授权测试路径）', () => {
  let context: BrowserContext;
  let extensionPage: Page;
  let origin = '';
  let extensionCopy = '';
  let server: ReturnType<typeof createServer>;
  const pdf = createTwoPagePdf();
  const authenticatedPdf = createTwoPagePdf('Authenticated');
  const archive = Buffer.from(zipSync({
    'nested/paper_content_list.json': strToU8(JSON.stringify([
      { page_idx: 0, type: 'title', text: 'Paper title' },
      { page_idx: 0, type: 'text', text: 'Introduction' },
      { page_idx: 1, type: 'title', text: 'Results' },
      { page_idx: 1, type: 'text', text: 'Main contribution' },
    ])),
  }));
  const observed = {
    urlTasks: [] as string[],
    translationPages: [] as number[],
    batchInitializations: 0,
    uploads: 0,
    batchDataId: '',
  };

  test.beforeAll(async ({ playwright }) => {
    server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', origin || 'http://127.0.0.1');

      if (requestUrl.pathname === '/download' && requestUrl.searchParams.get('id') === 'public') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(pdf);
        return;
      }

      if (requestUrl.pathname === '/download' && requestUrl.searchParams.get('id') === 'auth') {
        if (request.headers.cookie?.includes('pdf_auth=ok')) {
          response.writeHead(200, { 'content-type': 'application/pdf' });
          response.end(authenticatedPdf);
        } else {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><title>Sign in</title><p>Authentication required</p>');
        }
        return;
      }

      if (requestUrl.pathname === '/mineru/api/v4/extract/task' && request.method === 'POST') {
        const body = await readJson(request);
        observed.urlTasks.push(String(body.url ?? ''));
        json(response, { code: 0, data: { task_id: `url-${observed.urlTasks.length}` } });
        return;
      }

      if (requestUrl.pathname.startsWith('/mineru/api/v4/extract/task/') && request.method === 'GET') {
        json(response, {
          code: 0,
          data: { state: 'done', full_zip_url: `${origin}/results/paper.zip` },
        });
        return;
      }

      if (requestUrl.pathname === '/results/paper.zip') {
        response.writeHead(200, { 'content-type': 'application/zip' });
        response.end(archive);
        return;
      }

      if (requestUrl.pathname === '/mineru/api/v4/file-urls/batch' && request.method === 'POST') {
        const body = await readJson(request);
        const files = body.files as Array<{ data_id: string }>;
        observed.batchInitializations += 1;
        observed.batchDataId = files[0]?.data_id ?? '';
        json(response, {
          code: 0,
          data: {
            batch_id: 'authenticated-batch',
            file_urls: [`${origin}/signed-upload`],
          },
        });
        return;
      }

      if (requestUrl.pathname === '/signed-upload' && request.method === 'PUT') {
        for await (const _chunk of request) {
          // Drain the upload so Chromium can reuse the connection.
        }
        observed.uploads += 1;
        response.writeHead(200);
        response.end();
        return;
      }

      if (requestUrl.pathname === '/mineru/api/v4/extract-results/batch/authenticated-batch') {
        json(response, {
          code: 0,
          data: {
            extract_result: [{
              data_id: observed.batchDataId,
              state: 'done',
              full_zip_url: `${origin}/results/paper.zip`,
            }],
          },
        });
        return;
      }

      if (requestUrl.pathname === '/openai/v1/chat/completions' && request.method === 'POST') {
        const body = await readJson(request);
        const responseFormat = body.response_format as { type?: string } | undefined;
        if (responseFormat?.type === 'json_object') {
          const messages = body.messages as Array<{ role: string; content: string }>;
          const prompt = messages.find((message) => message.role === 'user')?.content ?? '';
          const input = JSON.parse(prompt.slice(prompt.indexOf('{'))) as {
            blocks: Array<{ id: string; text: string }>;
          };
          const page = input.blocks[0]?.id.match(/:p(\d+):/)?.[1];
          if (page) observed.translationPages.push(Number(page));
          json(response, {
            choices: [{
              message: {
                content: JSON.stringify({
                  translations: input.blocks.map((block) => ({
                    id: block.id,
                    text: `译文：${block.text}`,
                  })),
                }),
              },
            }],
          });
        } else {
          json(response, { choices: [{ message: { content: '主要贡献是验证端到端工作流 [p:2]' } }] });
        }
        return;
      }

      response.writeHead(404);
      response.end('not found');
    });
    await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('本地验收服务器未启动');
    origin = `http://127.0.0.1:${address.port}`;

    extensionCopy = await mkdtemp(resolve(tmpdir(), 'web-translate-pdf-workspace-'));
    const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')) as {
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    await import('node:fs/promises').then(({ cp }) => cp(extensionPath, extensionCopy, { recursive: true }));
    // 仅在临时测试副本中提升 HTTP(S) 可选权限，以验收已授权后的技术链路；
    // 不提升 file://，也不把此路径当作 action Popup 或原生权限门禁的验收。
    manifest.host_permissions = (manifest.optional_host_permissions ?? []).filter((pattern) =>
      pattern.startsWith('http://') || pattern.startsWith('https://'));
    await writeFile(resolve(extensionCopy, 'manifest.json'), JSON.stringify(manifest, null, 2));

    context = await playwright.chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${extensionCopy}`,
        `--load-extension=${extensionCopy}`,
      ],
    });
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.evaluate(({ fixtureOrigin }) => chrome.storage.local.set({
      'webpage-translation-settings': {
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        openAi: {
          baseUrl: `${fixtureOrigin}/openai/v1`,
          apiKey: 'e2e-openai-key',
          dialect: 'generic-openai',
          translation: {
            model: 'e2e-model',
            reasoning: { mode: 'off' },
            timeoutMs: 30000,
          },
          agent: {
            inheritTranslationModel: true,
            profile: {
              model: 'e2e-model',
              reasoning: { mode: 'auto' },
              timeoutMs: 120000,
            },
          },
        },
        mineru: {
          baseUrl: `${fixtureOrigin}/mineru`,
          token: 'e2e-mineru-token',
          modelVersion: 'vlm',
        },
      },
    }), { fixtureOrigin: origin });
    await context.addCookies([{ name: 'pdf_auth', value: 'ok', url: origin }]);
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
    if (extensionCopy) await rm(extensionCopy, { recursive: true, force: true });
  });

  async function enableWorkspace(pdfPage: Page): Promise<void> {
    await pdfPage.bringToFront();
    const [activeTab] = await extensionPage.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
    if (activeTab?.url !== pdfPage.url()) {
      throw new Error(`active tab 不匹配：Chrome=${activeTab?.url ?? '<missing>'}，Playwright=${pdfPage.url()}`);
    }
    const [execution] = await extensionPage.evaluate(async (tabId) => chrome.scripting.executeScript({
      target: { tabId },
      func: () => chrome.runtime.sendMessage({ type: 'pdf-workspace:enable' }),
    }), activeTab.id!);
    const response = execution?.result as
      | { ok: true; value: { enabled: boolean } }
      | { ok: false; error: string }
      | undefined;
    if (!response) throw new Error('PDF 工作台启用没有返回结果');
    if (!response.ok) throw new Error(`PDF 工作台启用失败：${response.error}`);
    expect(response.value.enabled).toBe(true);
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toBeVisible({ timeout: 30_000 });
  }

  test('公开 PDF 保持通用 URL，并完成解析、翻译、智能体、联动与恢复', async () => {
    observed.urlTasks.length = 0;
    observed.translationPages.length = 0;
    const sourceUrl = `${origin}/download?id=public#page=2`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl);
    await enableWorkspace(pdfPage);

    await expect(pdfPage).toHaveURL(sourceUrl);
    await expect(pdfPage.locator('[data-pdf-page="1"]')).toBeVisible();
    await expect(pdfPage.locator('[data-translation-page="2"]')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect.poll(() => observed.urlTasks.length).toBe(1);
    expect(observed.urlTasks[0]).toBe(sourceUrl);
    expect(observed.translationPages[0]).toBe(2);

    await pdfPage.getByLabel('向论文提问').fill('这篇论文的主要贡献是什么？');
    await pdfPage.getByRole('button', { name: '发送' }).click();
    await expect(pdfPage.getByText('主要贡献是验证端到端工作流')).toBeVisible();
    await pdfPage.getByRole('button', { name: '第 2 页' }).click();
    await expect(pdfPage.locator('[data-pdf-page="2"]')).toBeInViewport();
    await expect(pdfPage.locator('[data-translation-page="2"]')).toBeInViewport();

    await pdfPage.getByRole('button', { name: '收起' }).click();
    await expect(pdfPage.getByRole('button', { name: '展开论文智能体' })).toBeVisible();
    await pdfPage.getByRole('button', { name: '展开论文智能体' }).click();
    await expect(pdfPage.getByLabel('向论文提问')).toBeVisible();

    await pdfPage.getByRole('button', { name: '关闭工作台' }).click();
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(pdfPage).toHaveURL(sourceUrl);
    await pdfPage.reload();
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveCount(0);
    await expect(pdfPage).toHaveURL(sourceUrl);
    await pdfPage.close();
  });

  test('认证 PDF 在用户同意前不上传，同意后才走批量上传', async () => {
    observed.batchInitializations = 0;
    observed.uploads = 0;
    const sourceUrl = `${origin}/download?id=auth#page=2`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl);
    await enableWorkspace(pdfPage);

    await expect(pdfPage.getByRole('heading', { name: '确认发送到第三方解析服务' })).toBeVisible();
    await expect(pdfPage.getByText('MinerU', { exact: true })).toBeVisible();
    await expect(pdfPage.locator('[data-pdf-page="2"]')).toBeVisible();
    expect(observed.batchInitializations).toBe(0);
    expect(observed.uploads).toBe(0);

    await pdfPage.getByRole('button', { name: '同意并上传到 MinerU' }).click();
    await expect.poll(() => observed.batchInitializations).toBe(1);
    await expect.poll(() => observed.uploads).toBe(1);
    await expect(pdfPage.locator('[data-translation-page="2"]')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect(pdfPage).toHaveURL(sourceUrl);
    await pdfPage.close();
  });
});
