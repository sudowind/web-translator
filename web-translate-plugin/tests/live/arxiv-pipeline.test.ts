import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from 'vitest';

import { loadPdfSource } from '../../src/pdf/pdf-source';
import { MineruClient } from '../../src/providers/mineru/client';
import { loadMineruResult } from '../../src/providers/mineru/result-loader';
import { OpenAiTranslationClient } from '../../src/providers/openai/client';
import { PageScheduler } from '../../src/translation/page-scheduler';
import { translatePage } from '../../src/translation/translate-page';
import { loadLiveConfig } from './live-config';
import { safeErrorCode } from './live-report';

const SOURCE_URL = 'https://arxiv.org/pdf/1706.03762';
const EXPECTED_PAGE_COUNT = 15;
const TOTAL_TIMEOUT_MS = 25 * 60 * 1000;

test('arXiv 1706.03762 在线全链路', async () => {
  const config = await loadLiveConfig();
  const controller = new AbortController();
  const totalTimeout = setTimeout(
    () => controller.abort(new DOMException('在线验收总时限已到', 'AbortError')),
    TOTAL_TIMEOUT_MS,
  );
  let stage = 'PDF_DOWNLOAD';
  let destroyPdf: (() => Promise<void>) | undefined;

  try {
    const totalStartedAt = Date.now();
    const pdfStartedAt = Date.now();
    const { descriptor: source, bytes } = await loadPdfSource(SOURCE_URL, fetch, controller.signal);
    const loadingTask = getDocument({
      data: bytes,
      useWorkerFetch: false,
    });
    const pdf = await loadingTask.promise;
    destroyPdf = () => loadingTask.destroy();
    expect(pdf.numPages).toBe(EXPECTED_PAGE_COUNT);
    console.info('LIVE_STAGE', {
      stage,
      bytes: source.size,
      pages: pdf.numPages,
      durationMs: Date.now() - pdfStartedAt,
    });

    stage = 'MINERU_PARSE';
    const mineruStartedAt = Date.now();
    const mineru = new MineruClient(config.mineru);
    const task = await mineru.createUrlTask(SOURCE_URL, controller.signal);
    const result = await mineru.waitForResult(task, controller.signal);
    if (result.state !== 'done') {
      throw Object.assign(new Error('MINERU_TASK_FAILED'), {
        code: 'MINERU_TASK_FAILED',
      });
    }
    console.info('LIVE_STAGE', {
      stage,
      state: 'done',
      durationMs: Date.now() - mineruStartedAt,
    });

    stage = 'MINERU_RESULT';
    const resultStartedAt = Date.now();
    const document = await loadMineruResult(result.fullZipUrl, {
      sourceUrl: source.url,
      hash: source.hash,
      title: source.title,
      pageCount: pdf.numPages,
    });
    const documentBlockCount = document.pages.reduce(
      (sum, page) => sum + page.blocks.length,
      0,
    );
    expect(document.pageCount).toBe(pdf.numPages);
    expect(documentBlockCount).toBeGreaterThan(0);
    console.info('LIVE_STAGE', {
      stage,
      pages: document.pageCount,
      blocks: documentBlockCount,
      durationMs: Date.now() - resultStartedAt,
    });

    stage = 'TRANSLATION';
    const translationStartedAt = Date.now();
    const translationClient = new OpenAiTranslationClient(config.openAi);
    const scheduler = new PageScheduler(document.pageCount, 2);
    const completed: Array<{ page: number; blocks: number; durationMs: number }> = [];
    const failed: Array<{ page: number; code: string }> = [];

    const worker = async () => {
      while (true) {
        const pageNumber = scheduler.take();
        if (pageNumber === null) return;
        const pageStartedAt = Date.now();
        try {
          const translations = await translatePage(
            translationClient,
            document.pages[pageNumber - 1],
            {
              sourceLanguage: config.sourceLanguage,
              targetLanguage: config.targetLanguage,
            },
            controller.signal,
            undefined,
            config.openAi.defaultModel,
          );
          scheduler.markDone(pageNumber);
          const pageResult = {
            page: pageNumber,
            blocks: translations.length,
            durationMs: Date.now() - pageStartedAt,
          };
          completed.push(pageResult);
          console.info('LIVE_PAGE', { status: 'done', ...pageResult });
        } catch (error) {
          scheduler.markFailed(pageNumber);
          const failure = { page: pageNumber, code: safeErrorCode(error) };
          failed.push(failure);
          console.info('LIVE_PAGE', { status: 'failed', ...failure });
        }
      }
    };

    await Promise.all([worker(), worker()]);
    completed.sort((a, b) => a.page - b.page);
    failed.sort((a, b) => a.page - b.page);
    console.info('LIVE_SUMMARY', {
      paper: '1706.03762',
      pages: document.pageCount,
      blocks: documentBlockCount,
      completedPages: completed.length,
      failedPages: failed.length,
      translationDurationMs: Date.now() - translationStartedAt,
      totalDurationMs: Date.now() - totalStartedAt,
    });

    expect(failed).toEqual([]);
    expect(completed).toHaveLength(document.pageCount);
  } catch (error) {
    const code = safeErrorCode(error);
    console.info('LIVE_FAILURE', { stage, code });
    throw new Error(`LIVE_PIPELINE_FAILED:${stage}:${code}`);
  } finally {
    clearTimeout(totalTimeout);
    await destroyPdf?.();
  }
});
