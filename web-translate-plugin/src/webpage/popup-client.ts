import type { WebpageRuntimeStatus } from './webpage-runtime';

export type WebpageCommandType =
  | 'webpage:enable'
  | 'webpage:disable'
  | 'webpage:status';

interface PopupBrowserApi {
  tabs: {
    query(query: { active: true; currentWindow: true }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: { type: WebpageCommandType }): Promise<unknown>;
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  };
}

export async function sendWebpageCommand(
  type: WebpageCommandType,
  api?: PopupBrowserApi,
): Promise<WebpageRuntimeStatus> {
  const browserApi = api ?? (browser as unknown as PopupBrowserApi);
  const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('缺少活动标签页');
  if (type === 'webpage:enable') {
    await browserApi.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['/content-scripts/webpage.js'],
    });
  }
  const response = (await browserApi.tabs.sendMessage(tab.id, { type })) as
    | { ok: true; value: WebpageRuntimeStatus }
    | { ok: false; error: string };
  if (!response?.ok) throw new Error(response?.error ?? '页面未返回有效响应');
  return response.value;
}
