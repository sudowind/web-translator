interface TakeoverBrowserApi {
  tabs: {
    get(tabId: number): Promise<{ url?: string }>;
    sendMessage(tabId: number, message: { type: 'pdf-workspace:disable' }): Promise<unknown>;
    reload(tabId: number): Promise<void>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
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
}
