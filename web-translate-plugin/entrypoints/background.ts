import { classifyPdfTarget } from '../src/pdf-takeover/detect-pdf';
import { readPdfBytes } from '../src/pdf-takeover/fetch-pdf';
import {
  isPdfProbeMessage,
  type PdfProbeMessage,
  type PdfProbeResponse,
} from '../src/pdf-takeover/messages';
import { runTakeoverProbe } from '../src/pdf-takeover/probe-runner';
import {
  getLatestProbeResult,
  saveProbeResult,
} from '../src/pdf-takeover/report-store';
import {
  mountProbeSurface,
  restoreProbeSurface,
} from '../src/pdf-takeover/takeover-dom';

export default defineBackground(() => {
  console.info('PDF takeover probe ready');

  async function getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) {
      throw new Error('当前活动标签页缺少标签页 ID 或 URL');
    }
    return { id: tab.id, url: tab.url };
  }

  async function mount(tabId: number) {
    const [execution] = await browser.scripting.executeScript({
      target: { tabId },
      func: mountProbeSurface,
    });
    if (execution?.result === undefined) {
      throw new Error('探针脚本未返回接管结果');
    }
    return execution.result;
  }

  async function restore(tabId: number): Promise<boolean> {
    const [execution] = await browser.scripting.executeScript({
      target: { tabId },
      func: restoreProbeSurface,
    });
    return execution?.result ?? false;
  }

  async function runProbe() {
    const tab = await getActiveTab();
    try {
      const result = await runTakeoverProbe(
        {
          classify: (url) =>
            classifyPdfTarget({ url, contentType: 'application/pdf' }),
          mount,
          readBytes: readPdfBytes,
          restore,
        },
        tab,
      );
      await saveProbeResult(result);
      return result;
    } catch (error) {
      try {
        await restore(tab.id);
      } catch {
        // 保留原始运行错误，同时已完成尽力恢复。
      }
      throw error;
    }
  }

  async function handleProbeMessage(message: PdfProbeMessage) {
    if (message.type === 'pdf-probe:run') return runProbe();
    if (message.type === 'pdf-probe:latest') return getLatestProbeResult();

    if (message.type === 'pdf-probe:restore') {
      const tabId = message.tabId ?? (await getActiveTab()).id;
      return restore(tabId);
    }

    return null;
  }

  browser.runtime.onMessage.addListener((message: unknown, _, sendResponse) => {
    if (!isPdfProbeMessage(message)) return undefined;

    void handleProbeMessage(message).then(
      (value) => sendResponse({ ok: true, value } satisfies PdfProbeResponse),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies PdfProbeResponse),
    );

    return true;
  });
});
