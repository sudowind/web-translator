import { pdfSitePermission } from './reading-state';

export type PdfWorkspacePopupCommand = 'status' | 'enable' | 'disable';

export async function requestPdfResumePermission(
  url: string,
  api: { request(permissions: { origins: string[] }): Promise<boolean> } = browser.permissions,
): Promise<boolean> {
  const origin = pdfSitePermission(url);
  if (!origin) return false;
  try { return await api.request({ origins: [origin] }); }
  catch { return false; }
}

export interface PdfWorkspacePopupStatus {
  eligible: boolean;
  enabled: boolean;
  url: string;
}

interface PopupApi {
  runtime: {
    sendMessage(message: { type: string }): Promise<unknown>;
  };
}

export async function sendPdfWorkspaceCommand(
  command: PdfWorkspacePopupCommand,
  api: PopupApi = browser as unknown as PopupApi,
): Promise<PdfWorkspacePopupStatus> {
  const response = await api.runtime.sendMessage({
    type: `pdf-workspace:${command}`,
  }) as
    | { ok: true; value: PdfWorkspacePopupStatus }
    | { ok: false; error: string }
    | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'PDF 工作台后台未响应');
  return response.value;
}

export function isPdfWorkspacePopupMessage(
  value: unknown,
): value is { type: 'pdf-workspace:status' | 'pdf-workspace:enable' | 'pdf-workspace:disable' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 &&
    (record.type === 'pdf-workspace:status' ||
      record.type === 'pdf-workspace:enable' ||
      record.type === 'pdf-workspace:disable');
}
