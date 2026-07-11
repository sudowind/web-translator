import type { TakeoverProbeResult } from './contracts';

export type PdfProbeMessage =
  | { type: 'pdf-probe:run' }
  | { type: 'pdf-probe:restore'; tabId?: number }
  | { type: 'pdf-probe:latest' };

export type PdfProbeResponse =
  | {
      ok: true;
      value: TakeoverProbeResult | boolean | null;
    }
  | {
      ok: false;
      error: string;
    };

export function isPdfProbeMessage(message: unknown): message is PdfProbeMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return false;
  }

  if (
    message.type === 'pdf-probe:run' ||
    message.type === 'pdf-probe:latest'
  ) {
    return true;
  }

  if (message.type !== 'pdf-probe:restore') return false;

  const tabId = 'tabId' in message ? message.tabId : undefined;
  return (
    tabId === undefined ||
    (typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0)
  );
}
