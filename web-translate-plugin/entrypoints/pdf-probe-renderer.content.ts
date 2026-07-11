import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import { renderPdfFirstPage } from '../src/pdf-takeover/render-first-page';

GlobalWorkerOptions.workerSrc = workerUrl;

const listenerMarker = '__webTranslatePdfProbeRendererReady';

export default defineContentScript({
  registration: 'runtime',
  main() {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    if (scope[listenerMarker]) return;
    scope[listenerMarker] = true;

    browser.runtime.onMessage.addListener((message: unknown, _, sendResponse) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== 'pdf-probe-renderer:mount' ||
        !('url' in message) ||
        typeof message.url !== 'string'
      ) {
        return undefined;
      }

      void renderPdfFirstPage(message.url, (url) =>
        getDocument({ url, withCredentials: true }),
      ).then(
        (result) => sendResponse({ ok: true, result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return true;
    });
  },
});
