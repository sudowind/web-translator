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
import { isPdfMessage, type PdfMessage, type PdfMessageResponse } from '../src/pdf/messages';
import {
  isPdfWorkspacePopupMessage,
  type PdfWorkspacePopupStatus,
} from '../src/pdf/popup-client';
import { ChromePdfTakeoverAdapter } from '../src/pdf/takeover-port';
import { PdfWorkspaceService } from '../src/pdf/workspace-service';
import { arxivSourceKeyMatches, resolveArxivSource, samePdfSource } from '../src/pdf/arxiv-source';
import { getSettings } from '../src/settings/store';
import {
  dispatchSettingsTestLlm,
  isSettingsTestLlmCandidate,
  normalizeExtensionPageUrl,
} from '../src/settings/test-provider';
import { WebpageTranslationService } from '../src/webpage/translation-service';
import { PageTranslationError } from '../src/translation/translate-page';
import { PdfAutoResumeController } from '../src/pdf/auto-resume';
import { PdfReadingStateStore, isPdfReadingMessage } from '../src/pdf/reading-state';
import { handlePdfReadingMessage } from '../src/pdf/reading-state-handler';

export default defineBackground(() => {
  console.info('PDF takeover probe ready');
  const webpageTranslation = new WebpageTranslationService(getSettings);
  const pdfWorkspace = new PdfWorkspaceService();
  const pdfTakeover = new ChromePdfTakeoverAdapter();
  const pdfReading = new PdfReadingStateStore();
  const pdfResume = new PdfAutoResumeController(pdfReading, {
    getTab: (tabId) => browser.tabs.get(tabId),
    status: (tabId) => pdfTakeover.status(tabId),
    mountRemembered: (tabId, url) => pdfTakeover.mountRemembered(tabId, url),
  });
  void pdfWorkspace.resumePending().catch(() => undefined);

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

  async function handlePdfWorkspacePopup(
    message: { type: 'pdf-workspace:status' | 'pdf-workspace:enable' | 'pdf-workspace:disable' },
    sender: Browser.runtime.MessageSender,
  ): Promise<PdfWorkspacePopupStatus> {
    const tab = sender.tab?.id !== undefined && sender.tab.url
      ? { id: sender.tab.id, url: sender.tab.url }
      : await getActiveTab();
    if (message.type !== 'pdf-workspace:status') pdfResume.invalidate(tab.id);
    return pdfResume.serialize(tab.id, async () => {
      const currentTab = await browser.tabs.get(tab.id);
      if (currentTab.url !== tab.url) throw new Error('PDF_URL_CHANGED');
      const mounted = await pdfTakeover.status(tab.id);
      const eligible = mounted || isLikelyPdfUrl(tab.url) || await pdfTakeover.probePdfContentType(tab.id).catch(() => false);
      if (message.type === 'pdf-workspace:enable') {
        if (!eligible) throw new Error('PDF_NOT_ELIGIBLE');
        if (!mounted) await pdfTakeover.mount(tab.id);
        if (!currentTab.incognito) await pdfReading.setEnabled(tab.url, true);
      } else if (message.type === 'pdf-workspace:disable') {
        if (!currentTab.incognito) await pdfReading.setEnabled(tab.url, false);
        if (mounted) {
          pdfWorkspace.dispose(tab.id);
          await pdfTakeover.restore(tab.id);
        }
      }
      const enabled = message.type === 'pdf-workspace:disable' ? false : await pdfTakeover.status(tab.id);
      return { eligible, enabled, url: tab.url };
    });
  }

  browser.tabs.onRemoved.addListener((tabId) => {
    pdfWorkspace.dispose(tabId);
    pdfResume.forget(tabId);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'loading') {
      pdfWorkspace.dispose(tabId);
      pdfResume.invalidate(tabId);
    }
    if (changeInfo.status === 'complete' && tab.url && !tab.incognito) {
      void pdfResume.restore(tabId, tab.url).catch(() => undefined);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _, sendResponse) => {
    if (isPdfReadingMessage(message)) {
      void handlePdfReadingMessage(message, _, {
        getTab: (tabId) => browser.tabs.get(tabId),
        status: (tabId, documentId) => pdfTakeover.status(tabId, documentId),
        capture: (tabId) => pdfResume.capture(tabId),
        store: pdfReading,
      }).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) => sendResponse({ ok: false, error: safePdfError(error) }),
      );
      return true;
    }
    if (isPdfWorkspacePopupMessage(message)) {
      void handlePdfWorkspacePopup(message, _).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) => sendResponse({ ok: false, error: safePdfError(error) }),
      );
      return true;
    }

    if (isPdfMessage(message)) {
      const tabId = _.tab?.id;
      const senderUrl = _.url ?? _.tab?.url;
      if (tabId === undefined || !senderUrl || !messageMatchesSender(message, senderUrl)) {
        sendResponse({ ok: false, error: 'PDF_MESSAGE_SENDER_INVALID' } satisfies PdfMessageResponse);
        return undefined;
      }
      void pdfWorkspace.handle(message, tabId).then(
        (value) => sendResponse({ ok: true, value } satisfies PdfMessageResponse),
        (error: unknown) => sendResponse(safePdfMessageError(error)),
      );
      return true;
    }

    if (isSettingsTestLlmCandidate(message)) {
      void dispatchSettingsTestLlm(
        message,
        _,
        normalizeExtensionPageUrl(browser.runtime.getURL('/options.html')),
      ).then(sendResponse);
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

function messageMatchesSender(message: PdfMessage, senderUrl: string): boolean {
  if (message.type === 'pdf:parse-start') {
    return arxivSourceKeyMatches(message.source.url, message.source.hash) &&
      samePdfSource(message.source.url, senderUrl);
  }
  if (message.type === 'pdf:document-resolve' || message.type === 'pdf:cache-clear-source') {
    return samePdfSource(message.sourceUrl, senderUrl);
  }
  return true;
}

function safePdfError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : error instanceof Error ? error.message : undefined;
  return typeof code === 'string' && /^(PDF|MINERU|TRANSLATION|AGENT)_[A-Z0-9_]+$/.test(code)
    ? code
    : 'PDF_OPERATION_FAILED';
}

function safePdfMessageError(error: unknown): Extract<PdfMessageResponse, { ok: false }> {
  if (error instanceof PageTranslationError) {
    return { ok: false, error: error.failure.code, failure: error.failure };
  }
  return { ok: false, error: safePdfError(error) };
}

function isLikelyPdfUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.pathname.toLowerCase().endsWith('.pdf') || resolveArxivSource(rawUrl) !== null;
  } catch {
    return false;
  }
}

function isWebpageTranslationCandidate(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message.type === 'translation:blocks' || message.type === 'translation:cancel')
  );
}
