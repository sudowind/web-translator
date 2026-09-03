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
const mineruResultUrl = 'https://cdn-mineru.openxlab.org.cn/pdf/e2e-paper.zip';
const mineruLongResultUrl = 'https://cdn-mineru.openxlab.org.cn/pdf/e2e-long-paper.zip';

function createTwoPagePdf(label = 'Public'): Buffer {
  const streams = [
    `BT /F1 18 Tf 72 720 Td (Page One - ${label}) Tj 0 -32 Td (Selectable introduction text) Tj ET`,
    'BT /F1 18 Tf 72 720 Td (Page Two - Main Contribution) Tj 0 -32 Td (Evidence and results) Tj ET',
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

function createLongPdf(pageCount = 76): Buffer {
  const pageObjectStart = 3;
  const contentObjectStart = pageObjectStart + pageCount;
  const fontObject = contentObjectStart + pageCount;
  const pageReferences = Array.from({ length: pageCount }, (_, index) => `${pageObjectStart + index} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`),
    ...Array.from({ length: pageCount }, (_, index) => {
      const stream = `BT /F1 18 Tf 72 720 Td (Long Document Page ${index + 1}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
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

function sse(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end([
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n'));
}

test.describe('PDF 工作台最终验收（授权测试路径）', () => {
  let context: BrowserContext;
  let extensionPage: Page;
  let origin = '';
  let extensionCopy = '';
  let server: ReturnType<typeof createServer>;
  const pdf = createTwoPagePdf();
  const failurePdf = createTwoPagePdf('Failure Diagnostics');
  const authenticatedPdf = createTwoPagePdf('Authenticated');
  const longPdf = createLongPdf();
  const archive = Buffer.from(zipSync({
    'nested/paper_content_list.json': strToU8(JSON.stringify([
      { page_idx: 0, type: 'header', text: 'OmniGUI arXiv Preprint', bbox: [220, 112, 785, 124] },
      { page_idx: 0, type: 'aside_text', text: 'arXiv:fixture', bbox: [10, 100, 60, 800] },
      { page_idx: 0, type: 'text', text: 'Paper title', text_level: 1, bbox: [100, 80, 900, 150] },
      { page_idx: 0, type: 'text', text: 'Introduction with x squared', bbox: [100, 200, 900, 400] },
      { page_idx: 0, type: 'text', text: 'Scaled Dot-Product Attention', text_level: 3, bbox: [100, 405, 900, 455] },
      { page_idx: 0, type: 'list', text: '- First item\n- Second item', bbox: [100, 420, 900, 560] },
      {
        page_idx: 0,
        type: 'image',
        text: 'image OCR must not be translated',
        image_caption: ['Attention architecture'],
        img_path: 'images/secret-figure.png',
        bbox: [100, 460, 900, 560],
      },
      { page_idx: 0, type: 'interline_equation', text: '$$\n\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V \\tag{1}\n$$', bbox: [200, 580, 800, 680] },
      {
        page_idx: 0,
        type: 'table',
        text: 'table OCR must not be translated',
        table_caption: ['Attention results'],
        table_body: '<table><tr><td>secret table cell</td></tr></table>',
        bbox: [100, 700, 900, 900],
      },
      { page_idx: 0, type: 'footer', text: 'XPeng Motors', bbox: [220, 869, 311, 881] },
      { page_idx: 0, type: 'page_number', text: '1', bbox: [770, 869, 785, 881] },
      { page_idx: 1, type: 'header', text: 'OmniGUI arXiv Preprint', bbox: [220, 112, 785, 124] },
      { page_idx: 1, type: 'text', text: 'Results', text_level: 2, bbox: [100, 80, 900, 150] },
      { page_idx: 1, type: 'text', text: 'Main contribution', bbox: [100, 200, 900, 400] },
      { page_idx: 1, type: 'table', table_body: '<table><tr><td>no title</td></tr></table>' },
      { page_idx: 1, type: 'image', img_path: 'images/no-title.png' },
      { page_idx: 1, type: 'footer', text: 'XPeng Motors', bbox: [220, 869, 311, 881] },
      { page_idx: 1, type: 'page_number', text: '2', bbox: [770, 869, 785, 881] },
    ])),
  }));
  const longArchive = Buffer.from(zipSync({
    'nested/long_content_list.json': strToU8(JSON.stringify(Array.from({ length: 76 }, (_, index) => [
      { page_idx: index, type: 'text', text: `Long paper section ${index + 1}`, text_level: 2, bbox: [100, 80, 900, 150] },
      { page_idx: index, type: 'text', text: `Representative paragraph for page ${index + 1}.`, bbox: [100, 200, 900, 400] },
      { page_idx: index, type: 'list', text: `- Evidence ${index + 1}\n- Result ${index + 1}`, bbox: [100, 420, 900, 560] },
      { page_idx: index, type: 'interline_equation', text: `$$x_${index + 1}^2$$`, bbox: [200, 580, 800, 680] },
      { page_idx: index, type: 'image', image_caption: [`Figure ${index + 1}`], img_path: `images/${index + 1}.png`, bbox: [100, 700, 900, 850] },
    ]).flat())),
  }));
  const observed = {
    urlTasks: [] as string[],
    translationPages: [] as number[],
    translationBlocks: [] as Array<Array<{ id: string; kind?: string; text: string }>>,
    batchInitializations: 0,
    uploads: 0,
    batchDataId: '',
  };
  let translationFailureMode: 'none' | 'mixed' = 'none';
  let translationDelayMs = 0;
  let releaseAgentFinal: (() => void) | undefined;

  test.beforeAll(async ({ playwright }) => {
    server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', origin || 'http://127.0.0.1');

      if (requestUrl.pathname === '/download' && requestUrl.searchParams.get('id') === 'public') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(pdf);
        return;
      }

      if (requestUrl.pathname === '/download' && requestUrl.searchParams.get('id') === 'failure') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(failurePdf);
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

      if (requestUrl.pathname === '/download' && requestUrl.searchParams.get('id') === 'long') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(longPdf);
        return;
      }

      if (requestUrl.pathname === '/mineru/api/v4/extract/task' && request.method === 'POST') {
        const body = await readJson(request);
        observed.urlTasks.push(String(body.url ?? ''));
        json(response, { code: 0, data: { task_id: `url-${observed.urlTasks.length}` } });
        return;
      }

      if (requestUrl.pathname.startsWith('/mineru/api/v4/extract/task/') && request.method === 'GET') {
        const taskNumber = Number(requestUrl.pathname.split('/').pop()?.replace('url-', ''));
        const sourceUrl = observed.urlTasks[taskNumber - 1] ?? '';
        json(response, {
          code: 0,
          data: { state: 'done', full_zip_url: sourceUrl.includes('id=long') ? mineruLongResultUrl : mineruResultUrl },
        });
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
              full_zip_url: mineruResultUrl,
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
            blocks: Array<{ id: string; kind?: string; text: string }>;
          };
          const page = input.blocks[0]?.id.match(/:p(\d+):/)?.[1];
          observed.translationBlocks.push(input.blocks);
          if (page) observed.translationPages.push(Number(page));
          if (translationFailureMode === 'mixed' && page === '2') {
            response.writeHead(429, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'rate limited' } }));
            return;
          }
          if (translationDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, translationDelayMs));
          if (page === '1') await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
          sse(response, translationFailureMode === 'mixed' && page === '1'
            ? 'not json'
            : JSON.stringify({
              translations: input.blocks.map((block) => ({ id: block.id, text:
                block.kind === 'heading' ? (block.text === 'Paper title' ? '**论文标题**' : '**缩放点积注意力**') :
                block.kind === 'list' ? '- 第一项\n- 第二项' :
                block.kind === 'table' ? '注意力结果' :
                block.kind === 'figure' ? '注意力架构' :
                page === '1' ? Array.from({ length: 80 }, () => '这是**重点**，含行内公式 $x^2$。').join('\n') :
                `译文：${block.text}`,
              })),
            }));
        } else {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '## 主要贡献\n\n- 已验证流式回答\n- 保留公式' } }] })}\n\n`);
          await new Promise<void>((resolveAgent) => { releaseAgentFinal = resolveAgent; });
          releaseAgentFinal = undefined;
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '\n\n公式：$E=mc^2$\n\n| 项目 | 结果 |\n| --- | --- |\n| 流程 | 通过 |\n\n[p:2]' } }] })}\n\n`);
          response.end('data: {"choices":[],"usage":{"total_tokens":32}}\n\ndata: [DONE]\n\n');
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
      viewport: { width: 1440, height: 1000 },
      args: [
        `--disable-extensions-except=${extensionCopy}`,
        `--load-extension=${extensionCopy}`,
      ],
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.route(mineruResultUrl, (route) => route.fulfill({
      status: 200,
      contentType: 'application/zip',
      body: archive,
    }));
    await context.route(mineruLongResultUrl, (route) => route.fulfill({
      status: 200,
      contentType: 'application/zip',
      body: longArchive,
    }));
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
          defaultModel: 'e2e-model',
          translation: {
            reasoning: { mode: 'off' },
            timeoutMs: 30000,
          },
          agent: {
            inheritDefaultModel: true,
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
    releaseAgentFinal?.();
    await context?.close();
    await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
    if (extensionCopy) await rm(extensionCopy, { recursive: true, force: true });
  });

  test.afterEach(() => {
    translationDelayMs = 0;
    translationFailureMode = 'none';
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
    await expect(pdfPage.locator('.workspace-content')).toHaveCSS('display', 'grid');
    await expect(pdfPage.locator('.workspace-toolbar button').first()).toHaveCSS('min-height', '44px');
    await expect(pdfPage.locator('.agent-panel')).toHaveCount(0);
    await expect(pdfPage.getByRole('button', { name: '论文智能体' })).toHaveAttribute('aria-expanded', 'false');
    await expect(pdfPage.locator('.workspace-content')).toHaveClass(/agent-closed/);
  }

  test('公开 PDF 保持通用 URL，并完成解析、翻译、智能体、联动与恢复', async () => {
    test.setTimeout(120_000);
    translationFailureMode = 'none';
    observed.urlTasks.length = 0;
    observed.translationPages.length = 0;
    observed.translationBlocks.length = 0;
    const sourceUrl = `${origin}/download?id=public#page=2`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl);
    await enableWorkspace(pdfPage);

    await expect(pdfPage).toHaveURL(sourceUrl);
    await expect(pdfPage.locator('.workspace-title')).toHaveText('public.pdf');
    await expect(pdfPage.locator('[data-pdf-page="1"]')).toBeVisible();
    await expect(pdfPage.locator('[data-translation-page="1"]')).toHaveAttribute('data-status', 'translating', { timeout: 30_000 });
    const scrollTopBeforeTranslation = await pdfPage.evaluate(() => window.scrollY);
    await expect(pdfPage.locator('[data-translation-page="1"]')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    expect(Math.abs((await pdfPage.evaluate(() => window.scrollY)) - scrollTopBeforeTranslation)).toBeLessThanOrEqual(1);
    await expect(pdfPage.locator('[data-translation-page="2"]')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await expect.poll(() => observed.urlTasks.length).toBe(1);
    expect(observed.urlTasks[0]).toBe(sourceUrl);
    await expect.poll(() => observed.translationPages.length).toBeGreaterThanOrEqual(2);
    expect(observed.translationPages.slice(0, 2)).toEqual([1, 2]);
    const serializedBlocks = JSON.stringify(observed.translationBlocks);
    expect(serializedBlocks).toContain('Attention results');
    expect(serializedBlocks).toContain('Attention architecture');
    expect(serializedBlocks).not.toContain('secret table cell');
    expect(serializedBlocks).not.toContain('secret-figure.png');
    expect(serializedBlocks).not.toContain('table OCR must not be translated');
    expect(serializedBlocks).not.toContain('image OCR must not be translated');
    expect(serializedBlocks).not.toContain('OmniGUI arXiv Preprint');
    expect(serializedBlocks).not.toContain('XPeng Motors');
    expect(serializedBlocks).not.toContain('arXiv:fixture');

    const pageOne = pdfPage.locator('[data-translation-page="1"]');
    await expect(pageOne.locator('[data-block-kind="heading"] h3 strong')).toHaveText('论文标题');
    await expect(pageOne.locator('[data-block-kind="heading"] h5 strong')).toHaveText('缩放点积注意力');
    await expect(pageOne.locator('[data-block-kind="list"] ul')).toBeVisible();
    await expect(pageOne.locator('[data-media-kind="table"]')).toContainText('注意力结果');
    await expect(pageOne.locator('[data-media-kind="figure"]')).toContainText('注意力架构');
    await expect(pageOne.locator('.translation-page-body table')).toHaveCount(0);
    await expect(pageOne.locator('.translation-page-body img')).toHaveCount(0);
    await expect(pdfPage.locator('[data-translation-page="2"] [data-media-state]')).toHaveText(['无标题', '无标题']);
    await expect(pageOne.locator('[data-block-kind="formula"] .katex-display')).toBeVisible();
    await expect(pageOne.locator('[data-block-kind="formula"] .katex-error')).toHaveCount(0);
    await expect(pageOne.locator('[data-block-kind="formula"]')).toContainText('(1)');
    const pageInput = pdfPage.getByLabel('跳转页码');
    await pageInput.fill('2');
    await pageInput.press('Enter');
    await expect(pdfPage.locator('[data-page-pair="2"]')).toBeInViewport();
    await pageInput.fill('1');
    await pageInput.press('Enter');
    await expect(pdfPage.locator('[data-page-pair="1"]')).toBeInViewport();
    await pageInput.blur();
    await pdfPage.evaluate(() => window.scrollTo(0, 0));
    await expect(pdfPage).toHaveScreenshot('editorial-workspace-agent-closed.png', {
      animations: 'disabled',
    });

    await pdfPage.setViewportSize({ width: 2560, height: 1271 });
    await pdfPage.evaluate(() => window.scrollTo(0, 150));
    const anchorProgressBeforeZoom = await pdfPage.locator('[data-page-pair="1"]').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (68 - rect.top) / rect.height;
    });
    for (let step = 0; step < 7; step += 1) await pdfPage.getByRole('button', { name: '放大' }).click();
    await expect(pdfPage.locator('.paired-page-stream')).toHaveAttribute('data-render-scale', '1.80');
    await expect(pdfPage.locator('[data-page-pair="1"] .pdf-page-canvas-wrap')).toHaveAttribute('data-rendering', 'false');
    const anchorError = await pdfPage.locator('[data-page-pair="1"]').evaluate((element, previousProgress) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(((68 - rect.top) / rect.height) - previousProgress) * rect.height;
    }, anchorProgressBeforeZoom);
    expect(anchorError).toBeLessThanOrEqual(8);
    await pdfPage.evaluate(() => window.scrollTo(0, 0));
    const compactClosed = await pdfPage.evaluate(() => {
      const stream = document.querySelector('.paired-page-stream')!.getBoundingClientRect();
      const pair = document.querySelector('[data-page-pair="1"]')!.getBoundingClientRect();
      const pdf = document.querySelector('[data-page-pair="1"] .page-pair-pdf')!.getBoundingClientRect();
      const translation = document.querySelector('[data-page-pair="1"] .page-pair-translation')!.getBoundingClientRect();
      const canvas = document.querySelector<HTMLCanvasElement>('[data-page-pair="1"] canvas[data-active="true"]')!;
      const canvasRect = canvas.getBoundingClientRect();
      return {
        mode: document.querySelector('[data-page-pair="1"]')!.getAttribute('data-layout'),
        gutter: translation.left - pdf.right,
        translationWidth: translation.width,
        outerMarginDifference: Math.abs(pair.left - stream.left - (stream.right - pair.right)),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        bitmapDensity: canvas.width / canvasRect.width,
      };
    });
    expect(compactClosed.mode).toBe('paired');
    expect(compactClosed.gutter).toBeGreaterThanOrEqual(12);
    expect(compactClosed.gutter).toBeLessThanOrEqual(21);
    expect(compactClosed.translationWidth).toBeLessThanOrEqual(720.5);
    expect(compactClosed.outerMarginDifference).toBeLessThanOrEqual(2);
    expect(compactClosed.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(compactClosed.bitmapDensity).toBeGreaterThanOrEqual(1);
    await expect(pdfPage).toHaveScreenshot('compact-reading-2560-180.png', { animations: 'disabled' });

    const wideAgentToggle = pdfPage.getByRole('button', { name: '论文智能体' });
    await wideAgentToggle.click();
    await expect(pdfPage.locator('.agent-panel')).toBeVisible();
    const compactOpen = await pdfPage.evaluate(() => {
      const pair = document.querySelector('[data-page-pair="1"]')!.getBoundingClientRect();
      const pdf = document.querySelector('[data-page-pair="1"] .page-pair-pdf')!.getBoundingClientRect();
      const translation = document.querySelector('[data-page-pair="1"] .page-pair-translation')!.getBoundingClientRect();
      const agent = document.querySelector('.agent-panel')!.getBoundingClientRect();
      return {
        mode: document.querySelector('[data-page-pair="1"]')!.getAttribute('data-layout'),
        gutter: translation.left - pdf.right,
        translationWidth: translation.width,
        overlap: Math.max(0, pair.right - agent.left),
      };
    });
    expect(compactOpen.mode).toBe('paired');
    expect(compactOpen.gutter).toBeGreaterThanOrEqual(12);
    expect(compactOpen.gutter).toBeLessThanOrEqual(21);
    expect(compactOpen.translationWidth).toBeLessThanOrEqual(720.5);
    expect(compactOpen.overlap).toBe(0);
    await expect(pdfPage).toHaveScreenshot('compact-reading-2560-180-agent-open.png', { animations: 'disabled' });
    await pdfPage.getByRole('button', { name: '收起' }).click();

    for (let step = 0; step < 7; step += 1) await pdfPage.getByRole('button', { name: '缩小' }).click();
    await expect(pdfPage.locator('.paired-page-stream')).toHaveAttribute('data-render-scale', '1.10');
    await pdfPage.setViewportSize({ width: 1440, height: 1000 });
    await pageOne.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(pageOne).toHaveScreenshot('rich-translation-page.png', { animations: 'disabled' });
    const richTranslationBody = pageOne.locator('.translation-page-body');
    await richTranslationBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await pageOne.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(pageOne).toHaveScreenshot('rich-translation-formats.png', { animations: 'disabled' });
    await richTranslationBody.evaluate((element) => { element.scrollTop = 0; });

    await expect.poll(async () => {
      const pdfHeight = await pdfPage.locator('[data-page-pair="1"] .page-pair-pdf').evaluate((element) => element.getBoundingClientRect().height);
      const translationHeight = await pdfPage.locator('[data-translation-page="1"]').evaluate((element) => element.getBoundingClientRect().height);
      return Math.abs(pdfHeight - translationHeight);
    }).toBeLessThanOrEqual(1);

    const firstTranslationBody = pdfPage.locator('[data-translation-page="1"] .translation-page-body');
    expect(await firstTranslationBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await pdfPage.locator('[data-page-pair="1"] .page-pair-pdf').hover();
    await pdfPage.mouse.wheel(0, -2_000);
    await expect(pdfPage.locator('[data-pdf-page="1"]')).toBeInViewport();
    await expect(pdfPage.locator('[data-translation-page="1"]')).toBeInViewport();

    const paragraphBlock = pageOne.locator('[data-block-kind="paragraph"]');
    await pdfPage.waitForTimeout(300);
    const translationRenderCountBeforeHover = await pageOne.getAttribute('data-translation-render-count');
    await paragraphBlock.hover();
    const highlight = pdfPage.locator('[data-page-pair="1"] .pdf-block-highlight');
    await expect(highlight).toBeVisible();
    await expect(pageOne).toHaveAttribute('data-translation-render-count', translationRenderCountBeforeHover!);
    const highlightError = await pdfPage.evaluate(() => {
      const wrap = document.querySelector('[data-page-pair="1"] .pdf-page-canvas-wrap')!.getBoundingClientRect();
      const box = document.querySelector('[data-page-pair="1"] .pdf-block-highlight')!.getBoundingClientRect();
      const expected = { left: wrap.left + wrap.width * .1, top: wrap.top + wrap.height * .2, width: wrap.width * .8, height: wrap.height * .2 };
      return Math.max(Math.abs(box.left - expected.left), Math.abs(box.top - expected.top), Math.abs(box.width - expected.width), Math.abs(box.height - expected.height));
    });
    expect(highlightError).toBeLessThanOrEqual(1);
    await paragraphBlock.click();
    await expect(paragraphBlock).toHaveAttribute('data-pinned', 'true');
    await pdfPage.locator('[data-page-pair="1"] .page-pair-pdf').hover();
    await expect(highlight).toBeVisible();
    await pageOne.locator('[data-block-kind="table"]').hover();
    await expect(highlight).toBeVisible();

    await expect.poll(() => pdfPage.locator('[data-page-pair="1"] .pdf-text-layer span').count()).toBeGreaterThanOrEqual(2);
    const selected = await pdfPage.evaluate(() => {
      const spans = document.querySelectorAll<HTMLElement>('[data-page-pair="1"] .pdf-text-layer span');
      const first = spans[0].firstChild!;
      const second = spans[1].firstChild!;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(second, second.textContent?.length ?? 0);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    expect(selected.trim()).not.toBe('');
    await firstTranslationBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await firstTranslationBody.hover();
    await pdfPage.mouse.wheel(0, 500);
    await expect(pdfPage.locator('[data-pdf-page="2"]')).toBeInViewport();
    await expect(pdfPage.locator('[data-translation-page="2"]')).toBeInViewport();

    const agentToggle = pdfPage.getByRole('button', { name: '论文智能体' });
    await agentToggle.click();
    await expect(agentToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(pdfPage.locator('.agent-panel')).toBeVisible();
    const overlap = await pdfPage.evaluate(() => {
      const translation = document.querySelector('[data-translation-page="1"]')!.getBoundingClientRect();
      const agent = document.querySelector('.agent-panel')!.getBoundingClientRect();
      return Math.max(0, translation.right - agent.left);
    });
    expect(overlap).toBe(0);
    await expect(pdfPage).toHaveScreenshot('editorial-workspace-agent-open.png', {
      animations: 'disabled',
    });
    await pdfPage.getByRole('button', { name: '概括论文的主要贡献' }).click();
    await expect(pdfPage.getByLabel('向论文提问')).toHaveValue('概括论文的主要贡献');
    await pdfPage.getByLabel('向论文提问').fill('这篇论文的主要贡献是什么？');
    await pdfPage.getByRole('button', { name: '发送' }).click();
    const streamedAnswer = pdfPage.locator('.agent-messages [data-role="assistant"]').last();
    await expect(streamedAnswer.getByRole('heading', { name: '主要贡献' })).toBeVisible();
    await expect(streamedAnswer).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => typeof releaseAgentFinal).toBe('function');
    const readingRenderCountDuringAgent = await pdfPage.locator('.paired-page-stream').getAttribute('data-reading-render-count');
    await expect(pdfPage.locator('.agent-panel')).toHaveScreenshot('agent-streaming.png', { animations: 'disabled' });
    releaseAgentFinal?.();
    await expect(streamedAnswer.locator('table')).toBeVisible();
    await expect(streamedAnswer.locator('.katex')).toBeVisible();
    await expect(streamedAnswer).toHaveAttribute('data-status', 'done');
    await expect(pdfPage.locator('.paired-page-stream')).toHaveAttribute('data-reading-render-count', readingRenderCountDuringAgent!);
    await expect(pdfPage.locator('.agent-panel')).toHaveScreenshot('agent-rich-answer.png', { animations: 'disabled' });
    await pdfPage.getByRole('button', { name: '第 2 页' }).click();
    await expect(pdfPage.locator('[data-pdf-page="2"]')).toBeInViewport();
    await expect(pdfPage.locator('[data-translation-page="2"]')).toBeInViewport();

    await pdfPage.getByRole('button', { name: '收起' }).click();
    await expect(pdfPage.locator('.agent-panel')).toHaveCount(0);
    await expect(agentToggle).toHaveAttribute('aria-expanded', 'false');
    await agentToggle.click();
    await expect(pdfPage.getByLabel('向论文提问')).toBeVisible();

    for (const viewport of [{ width: 800, height: 800 }, { width: 375, height: 760 }]) {
      await pdfPage.setViewportSize(viewport);
      const responsiveLayout = await pdfPage.evaluate(() => {
        const toolbar = document.querySelector('.workspace-toolbar')!.getBoundingClientRect();
        const agent = document.querySelector('.agent-panel')!.getBoundingClientRect();
        return {
          toolbarHeight: toolbar.height,
          overlap: Math.max(0, toolbar.bottom - agent.top),
          agentBottomGap: Math.abs(innerHeight - agent.bottom),
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(responsiveLayout.toolbarHeight).toBe(60);
      expect(responsiveLayout.overlap).toBe(0);
      expect(responsiveLayout.agentBottomGap).toBeLessThanOrEqual(1);
      expect(responsiveLayout.horizontalOverflow).toBeLessThanOrEqual(1);
      await expect(pdfPage).toHaveScreenshot(`responsive-agent-${viewport.width}.png`, {
        animations: 'disabled',
      });
    }
    await pdfPage.setViewportSize({ width: 1440, height: 1000 });

    const restoredPageLoaded = pdfPage.waitForEvent('load');
    await pdfPage.getByLabel('更多操作').click();
    await expect(pdfPage.getByRole('menu')).toBeVisible();
    await pdfPage.keyboard.press('Escape');
    await expect(pdfPage.getByRole('menu')).toHaveCount(0);
    await pdfPage.getByLabel('更多操作').click();
    await pdfPage.getByRole('menuitem', { name: '关闭工作台' }).click();
    await restoredPageLoaded;
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(pdfPage).toHaveURL(sourceUrl);
    await pdfPage.reload();
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveCount(0);
    await expect(pdfPage).toHaveURL(sourceUrl);
    await pdfPage.close();
  });

  test('76 页长文档按需翻译、限制正文挂载并支持模式切换和缓存恢复', async () => {
    test.setTimeout(120_000);
    translationFailureMode = 'none';
    translationDelayMs = 80;
    observed.translationPages.length = 0;
    observed.urlTasks.length = 0;
    const sourceUrl = `${origin}/download?id=long#page=40`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl);
    await pdfPage.evaluate(() => {
      const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
      const metrics = { startedAt: performance.now(), startHeap: memory.memory?.usedJSHeapSize, longTasks: [] as number[] };
      (window as typeof window & { __pdfLongMetrics?: typeof metrics }).__pdfLongMetrics = metrics;
      new PerformanceObserver((list) => {
        metrics.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: 'longtask', buffered: true });
    });
    await enableWorkspace(pdfPage);

    await expect(pdfPage.locator('.workspace-toolbar')).toHaveAttribute('data-translation-mode', 'on-demand', { timeout: 30_000 });
    await expect(pdfPage.locator('[data-page-pair]')).toHaveCount(76);
    await expect(pdfPage.locator('[data-translation-page]')).toHaveCount(76);
    await expect(pdfPage.locator('[data-page-pair="40"]')).toBeInViewport();
    await expect(pdfPage.locator('[data-page-pair="40"] canvas[data-active="true"]')).toBeVisible();
    const firstReadableMs = await pdfPage.evaluate(() => performance.now() -
      (window as typeof window & { __pdfLongMetrics: { startedAt: number } }).__pdfLongMetrics.startedAt);
    await expect.poll(() => observed.translationPages.length).toBe(4);
    expect(new Set(observed.translationPages)).toEqual(new Set([39, 40, 41, 42]));
    await pdfPage.waitForTimeout(500);
    expect(observed.translationPages).toHaveLength(4);
    await expect(pdfPage.locator('[data-translation-body="full"]')).toHaveCount(5);
    await expect(pdfPage.locator('[data-translation-page="60"]')).toHaveAttribute('data-status', 'unrequested');
    await expect(pdfPage.locator('[data-translation-page="60"] [data-translation-body="deferred"]')).toHaveText('按需翻译');

    const frameIntervals = await pdfPage.evaluate(async () => {
      const samples: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 30; index += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame((timestamp) => {
          samples.push(timestamp - previous);
          previous = timestamp;
          window.scrollBy(0, 2);
          resolveFrame();
        }));
      }
      return samples.slice(1);
    });
    const benchmark = await pdfPage.evaluate(() => {
      const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
      const metrics = (window as typeof window & {
        __pdfLongMetrics: { startedAt: number; startHeap?: number; longTasks: number[] };
      }).__pdfLongMetrics;
      const endHeap = memory.memory?.usedJSHeapSize;
      return {
        longTaskCount: metrics.longTasks.length,
        longestTaskMs: Math.max(0, ...metrics.longTasks),
        heapDeltaBytes: endHeap !== undefined && metrics.startHeap !== undefined ? endHeap - metrics.startHeap : null,
        readingRenderCount: Number(document.querySelector('.paired-page-stream')?.getAttribute('data-reading-render-count') ?? 0),
        maxRenderToCommitMs: Number(document.querySelector('.paired-page-stream')?.getAttribute('data-reading-max-render-to-commit-ms') ?? 0),
      };
    });
    console.info('PDF_LONG_DOCUMENT_BENCHMARK', {
      ...benchmark,
      firstReadableMs,
      mountedTranslationBodies: 5,
      initialProviderPages: 4,
      maxFrameIntervalMs: Math.max(...frameIntervals),
    });

    const initialRequestCount = observed.translationPages.length;
    await pdfPage.evaluate(async () => {
      for (const page of [10, 20, 30]) {
        document.querySelector<HTMLElement>(`[data-page-pair="${page}"]`)!.scrollIntoView({ block: 'start' });
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      }
    });
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveAttribute('data-pdf-render-page', '30');
    await pdfPage.waitForTimeout(100);
    expect(observed.translationPages).toHaveLength(initialRequestCount);
    await expect.poll(() => observed.translationPages.length).toBe(initialRequestCount + 4);
    expect(new Set(observed.translationPages.slice(initialRequestCount))).toEqual(new Set([29, 30, 31, 32]));

    const pageInput = pdfPage.getByLabel('跳转页码');
    await pageInput.fill('60');
    await pageInput.press('Enter');
    await expect(pdfPage.locator('[data-page-pair="60"]')).toBeInViewport();
    await expect.poll(() => observed.translationPages.includes(60)).toBe(true);
    expect(observed.translationPages.indexOf(60)).toBeLessThanOrEqual(initialRequestCount + 5);
    await expect.poll(() => observed.translationPages.length).toBe(initialRequestCount + 8);
    for (const page of [59, 60, 61, 62]) {
      await expect(pdfPage.locator(`[data-translation-page="${page}"]`)).toHaveAttribute('data-status', 'done');
    }

    const fullDocumentStart = observed.translationPages.length;
    await pdfPage.getByLabel('更多操作').click();
    await pdfPage.getByRole('menuitem', { name: '翻译全文' }).click();
    await expect(pdfPage.locator('.workspace-toolbar')).toHaveAttribute('data-translation-mode', 'full-document');
    await expect.poll(() => observed.translationPages.length).toBeGreaterThanOrEqual(fullDocumentStart + 8);
    const firstFullDocumentPages = observed.translationPages.slice(fullDocumentStart, fullDocumentStart + 8);
    expect(firstFullDocumentPages).toEqual([...firstFullDocumentPages].sort((left, right) => left - right));
    await pdfPage.getByLabel('更多操作').click();
    await pdfPage.getByRole('menuitem', { name: '改为按需' }).click();
    const stoppedAt = observed.translationPages.length;
    await pdfPage.waitForTimeout(500);
    expect(observed.translationPages.length - stoppedAt).toBeLessThanOrEqual(2);
    await expect(pdfPage.locator('.workspace-toolbar')).toHaveAttribute('data-translation-mode', 'on-demand');

    await pdfPage.close();
    observed.translationPages.length = 0;
    const cachedPage = await context.newPage();
    await cachedPage.goto(sourceUrl);
    await enableWorkspace(cachedPage);
    await expect(cachedPage.locator('main[data-renderer="pdfjs"]')).toHaveAttribute('data-translation-snapshot-count', '1');
    await expect(cachedPage.locator('[data-translation-page="40"]')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await cachedPage.waitForTimeout(700);
    expect(observed.translationPages).toEqual([]);
    await cachedPage.close();
  });

  test('真实 arXiv 76 页样本可由内容脚本读取并保持原 URL 恢复', async () => {
    test.skip(process.env.PDF_ARXIV_FEASIBILITY !== '1', '仅用于一次性真实浏览器源读取门禁');
    test.setTimeout(180_000);
    const sourceUrl = 'https://arxiv.org/pdf/2510.12403';
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await enableWorkspace(pdfPage);
    await expect(pdfPage).toHaveURL(sourceUrl);
    await expect(pdfPage.locator('.workspace-title')).toContainText('2510.12403', { timeout: 90_000 });
    await expect(pdfPage.locator('.workspace-page-total')).toHaveText('/ 76', { timeout: 60_000 });
    await expect(pdfPage.locator('[data-pdf-page="1"] canvas[data-active="true"]')).toBeVisible();

    const restored = pdfPage.waitForEvent('load');
    await pdfPage.getByLabel('更多操作').click();
    await pdfPage.getByRole('menuitem', { name: '关闭工作台' }).click();
    await restored;
    await expect(pdfPage).toHaveURL(sourceUrl);
    await expect(pdfPage.locator('main[data-renderer="pdfjs"]')).toHaveCount(0);
    await pdfPage.close();
  });

  test('翻译失败显示默认收起的脱敏诊断并保留自动重试次数', async () => {
    translationFailureMode = 'mixed';
    observed.translationPages.length = 0;
    const sourceUrl = `${origin}/download?id=failure#page=1`;
    const pdfPage = await context.newPage();
    await pdfPage.goto(sourceUrl);
    await enableWorkspace(pdfPage);

    const pageOne = pdfPage.locator('[data-translation-page="1"]');
    const pageTwo = pdfPage.locator('[data-translation-page="2"]');
    await expect(pageOne).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(pageTwo).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(pageOne.getByText('失败：模型返回的 JSON 无法解析')).toBeVisible();
    await expect(pageTwo.getByText('失败：接口限流')).toBeVisible();
    expect(observed.translationPages.filter((page) => page === 2)).toHaveLength(3);

    const details = pageOne.locator('details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.getByText('TRANSLATION_JSON_INVALID')).toBeVisible();
    await details.getByRole('button', { name: '复制诊断信息' }).click();
    const copied = await pdfPage.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('TRANSLATION_JSON_INVALID');
    expect(copied).not.toContain('e2e-openai-key');
    expect(copied).not.toContain('Paper title');
    await pdfPage.close();
    translationFailureMode = 'none';
  });

  test('认证 PDF 在用户同意前不上传，同意后才走批量上传', async () => {
    translationFailureMode = 'none';
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
