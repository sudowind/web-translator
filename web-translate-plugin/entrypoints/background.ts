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
import { restoreProbeSurface } from '../src/pdf-takeover/takeover-dom';
import { getSettings } from '../src/settings/store';
import {
  isSettingsTestProviderMessage,
  testProviderConnection,
} from '../src/settings/test-provider';
import { WebpageTranslationService } from '../src/webpage/translation-service';

export default defineBackground(() => {
  console.info('PDF takeover probe ready');
  const webpageTranslation = new WebpageTranslationService(getSettings);

  async function getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) {
      throw new Error('当前活动标签页缺少标签页 ID 或 URL');
    }
    return { id: tab.id, url: tab.url };
  }

  async function mount(tabId: number, url: string) {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/pdf-probe-renderer.js'],
    });

    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'pdf-probe-renderer:mount',
      url,
    })) as
      | {
          ok: true;
          result: {
            href: string;
            injected: boolean;
            rendererVerified: boolean;
          };
        }
      | { ok: false; error: string };
    if (!response?.ok) {
      throw new Error(response?.error ?? 'PDF.js renderer 未返回接管结果');
    }
    return response.result;
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
    if (isSettingsTestProviderMessage(message)) {
      void testProviderConnection(message.settings).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return true;
    }

    if (isWebpageTranslationCandidate(message)) {
      void webpageTranslation.handle(message, _).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return true;
    }

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

function isWebpageTranslationCandidate(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message.type === 'translation:blocks' || message.type === 'translation:cancel')
  );
}
