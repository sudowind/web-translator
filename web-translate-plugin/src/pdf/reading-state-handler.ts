import type { PdfReadingMessage, PdfReadingStateStore } from './reading-state';

interface ReadingSender { tab?: { id?: number }; url?: string; frameId?: number; documentId?: string }
interface ReadingHandlerPorts {
  getTab(tabId: number): Promise<{ url?: string; incognito?: boolean }>;
  status(tabId: number, documentId: string): Promise<boolean>;
  capture(tabId: number): () => boolean;
  store: Pick<PdfReadingStateStore, 'get' | 'savePosition'>;
}

export async function handlePdfReadingMessage(message: PdfReadingMessage, sender: ReadingSender, ports: ReadingHandlerPorts) {
  const invalid = () => new Error('PDF_MESSAGE_SENDER_INVALID');
  const tabId = sender.tab?.id;
  if (tabId === undefined || !sender.url || sender.frameId !== 0 || !sender.documentId) throw invalid();
  const isCurrent = ports.capture(tabId);
  const tab = await ports.getTab(tabId);
  if (tab.url !== sender.url || tab.incognito || !isCurrent() || !await ports.status(tabId, sender.documentId) || !isCurrent()) throw invalid();
  if (message.type === 'pdf:reading-get') {
    const state = await ports.store.get(sender.url);
    if (!isCurrent()) throw invalid();
    return state;
  }
  // Recheck inside the serialized storage update, not just before its async read.
  await ports.store.savePosition(sender.url, message, isCurrent);
  return null;
}
