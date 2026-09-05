interface TakeoverBrowserApi {
  tabs: {
    get(tabId: number): Promise<{ url?: string }>;
    sendMessage(tabId: number, message: { type: 'pdf-workspace:disable' | 'pdf-workspace:status' }, options?: { documentId: string }): Promise<unknown>;
    reload(tabId: number): Promise<void>;
  };
  scripting: {
    insertCSS(details: { target: { tabId: number; documentIds?: string[] }; files: string[] }): Promise<void>;
    executeScript(details: { target: { tabId: number; documentIds?: string[] }; files?: string[]; func?: (...args: any[]) => unknown; args?: unknown[] }): Promise<unknown>;
  };
}

export interface PdfTakeoverPort {
  mount(tabId: number): Promise<{ originalUrl: string }>;
  restore(tabId: number): Promise<{ restored: boolean; url: string }>;
}

export class ChromePdfTakeoverAdapter implements PdfTakeoverPort {
  constructor(
    private readonly api: TakeoverBrowserApi = browser as unknown as TakeoverBrowserApi,
  ) {}

  async mount(tabId: number): Promise<{ originalUrl: string }> {
    const before = await this.api.tabs.get(tabId);
    if (!before.url) throw new Error('PDF_URL_MISSING');
    await this.api.scripting.insertCSS({
      target: { tabId },
      files: ['/content-scripts/pdf-workspace.css'],
    });
    await this.api.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/pdf-workspace.js'],
    });
    const after = await this.api.tabs.get(tabId);
    if (after.url !== before.url) throw new Error('PDF_URL_CHANGED');
    return { originalUrl: before.url };
  }

  async restore(tabId: number): Promise<{ restored: boolean; url: string }> {
    const before = await this.api.tabs.get(tabId);
    if (!before.url) throw new Error('PDF_URL_MISSING');
    const response = await this.api.tabs.sendMessage(tabId, {
      type: 'pdf-workspace:disable',
    }) as { ok?: boolean } | undefined;
    await this.api.tabs.reload(tabId);
    const after = await this.api.tabs.get(tabId);
    return {
      restored: response?.ok === true && after.url === before.url,
      url: after.url ?? '',
    };
  }

  async status(tabId: number, documentId?: string): Promise<boolean> {
    try {
      const response = await this.api.tabs.sendMessage(tabId, { type: 'pdf-workspace:status' }, documentId ? { documentId } : undefined) as { ok?: boolean; value?: { enabled?: boolean } };
      return response?.ok === true && response.value?.enabled === true;
    } catch {
      return false;
    }
  }

  async mountRemembered(tabId: number, expectedUrl: string): Promise<boolean> {
    const [execution] = await this.api.scripting.executeScript({
      target: { tabId },
      func: (url: string) => location.href === url && document.contentType.toLowerCase().includes('application/pdf'),
      args: [expectedUrl],
    }) as Array<{ result?: boolean; documentId?: string }>;
    if (execution?.result !== true || !execution.documentId) return false;
    const target = { tabId, documentIds: [execution.documentId] };
    await this.api.scripting.insertCSS({ target, files: ['/content-scripts/pdf-workspace.css'] });
    await this.api.scripting.executeScript({ target, files: ['/content-scripts/pdf-workspace.js'] });
    return true;
  }

  async probePdfContentType(tabId: number): Promise<boolean> {
    const [execution] = await this.api.scripting.executeScript({
      target: { tabId },
      func: () => document.contentType,
    }) as Array<{ result?: string }>;
    return execution?.result?.toLowerCase().includes('application/pdf') === true;
  }
}
