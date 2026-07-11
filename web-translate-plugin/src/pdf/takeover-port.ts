interface TakeoverBrowserApi {
  tabs: {
    get(tabId: number): Promise<{ url?: string }>;
    sendMessage(tabId: number, message: { type: 'pdf-workspace:disable' | 'pdf-workspace:status' }): Promise<unknown>;
    reload(tabId: number): Promise<void>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files?: string[]; func?: () => string }): Promise<unknown>;
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

  async status(tabId: number): Promise<boolean> {
    try {
      const response = await this.api.tabs.sendMessage(tabId, { type: 'pdf-workspace:status' }) as { ok?: boolean; value?: { enabled?: boolean } };
      return response?.ok === true && response.value?.enabled === true;
    } catch {
      return false;
    }
  }

  async probePdfContentType(tabId: number): Promise<boolean> {
    const [execution] = await this.api.scripting.executeScript({
      target: { tabId },
      func: () => document.contentType,
    }) as Array<{ result?: string }>;
    return execution?.result?.toLowerCase().includes('application/pdf') === true;
  }
}
