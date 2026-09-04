import './style.css';
import 'katex/dist/katex.min.css';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PdfWorkspace } from '../../src/pdf/PdfWorkspace';
import { isPdfReadingPosition } from '../../src/pdf/reading-state';

const marker = '__webTranslatePdfWorkspaceMounted';
let originalMarkup: string | null = null;
let root: Root | null = null;

export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_start',
  main() {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    if (scope[marker]) return;
    scope[marker] = true;
    const originalUrl = location.href;
    originalMarkup = document.documentElement.innerHTML;
    document.documentElement.innerHTML = '<head><title>PDF 翻译工作台</title></head><body><div id="web-translate-pdf-root"></div></body>';
    document.documentElement.dataset.webTranslatePdfWorkspace = 'true';
    if (location.href !== originalUrl) throw new Error('PDF_URL_CHANGED');
    const host = document.getElementById('web-translate-pdf-root');
    if (!host) throw new Error('PDF_ROOT_MISSING');
    root = createRoot(host);

    const handleDisable = (message: unknown, _: unknown, sendResponse: (value: unknown) => void) => {
      if (!isWorkspaceControl(message)) return undefined;
      if (message.type === 'pdf-workspace:status') {
        sendResponse({ ok: true, value: { enabled: true } });
        return undefined;
      }
      browser.runtime.onMessage.removeListener(handleDisable);
      root?.unmount();
      root = null;
      if (originalMarkup !== null) document.documentElement.innerHTML = originalMarkup;
      originalMarkup = null;
      delete document.documentElement.dataset.webTranslatePdfWorkspace;
      scope[marker] = false;
      sendResponse({ ok: true, value: { enabled: false } });
      return undefined;
    };
    browser.runtime.onMessage.addListener(handleDisable);
    const mountedRoot = root;
    void browser.runtime.sendMessage({ type: 'pdf:reading-get' }).then((response) => {
      if (root !== mountedRoot) return;
      const saved = response?.ok && isPdfReadingPosition(response.value) ? response.value : undefined;
      mountedRoot.render(<PdfWorkspace sourceUrl={originalUrl} initialReading={saved} />);
    }, () => {
      if (root === mountedRoot) mountedRoot.render(<PdfWorkspace sourceUrl={originalUrl} />);
    });
  },
});

function isWorkspaceControl(value: unknown): value is { type: 'pdf-workspace:disable' | 'pdf-workspace:status' } {
  return typeof value === 'object' && value !== null &&
    Object.keys(value).length === 1 &&
    'type' in value && (value.type === 'pdf-workspace:disable' || value.type === 'pdf-workspace:status');
}
