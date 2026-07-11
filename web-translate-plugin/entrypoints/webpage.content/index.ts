import tooltipCss from './original-tooltip.css?inline';

import type { WebpageBackgroundMessage } from '../../src/webpage/messages';
import {
  WebpageTranslationRuntime,
  type WebpageRuntimeStatus,
} from '../../src/webpage/webpage-runtime';

const listenerMarker = '__webTranslateWebpageRuntimeReady';

type Command =
  | { type: 'webpage:enable' }
  | { type: 'webpage:disable' }
  | { type: 'webpage:status' };

type CommandResponse =
  | { ok: true; value: WebpageRuntimeStatus }
  | { ok: false; error: string };

export default defineContentScript({
  registration: 'runtime',
  main() {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    if (scope[listenerMarker]) return;
    scope[listenerMarker] = true;

    const runtime = new WebpageTranslationRuntime({
      document,
      url: new URL(location.href),
      styleText: tooltipCss,
      sendMessage: async (message: WebpageBackgroundMessage) => {
        const response = (await browser.runtime.sendMessage(message)) as
          | { ok: true; value: unknown }
          | { ok: false; error: string };
        if (!response?.ok) throw new Error(response?.error ?? '后台未返回有效响应');
        return response.value;
      },
    });

    browser.runtime.onMessage.addListener((message: unknown, _, sendResponse) => {
      if (!isCommand(message)) return undefined;
      const operation =
        message.type === 'webpage:enable'
          ? runtime.enable()
          : message.type === 'webpage:disable'
            ? runtime.disable()
            : Promise.resolve(runtime.status());
      void operation.then(
        (value) => sendResponse({ ok: true, value } satisfies CommandResponse),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies CommandResponse),
      );
      return true;
    });
  },
});

function isCommand(value: unknown): value is Command {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    'type' in value &&
    (value.type === 'webpage:enable' ||
      value.type === 'webpage:disable' ||
      value.type === 'webpage:status')
  );
}
