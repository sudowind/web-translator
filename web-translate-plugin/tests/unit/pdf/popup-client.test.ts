import { describe, expect, it, vi } from 'vitest';

import { sendPdfWorkspaceCommand } from '../../../src/pdf/popup-client';

describe('PDF Popup 客户端', () => {
  it.each(['status', 'enable', 'disable'] as const)('通过后台发送 %s，不在 Popup 直接注入', async (command) => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, value: { eligible: true, enabled: command === 'enable', url: 'https://x.test/p.pdf' } });
    await expect(sendPdfWorkspaceCommand(command, { runtime: { sendMessage } })).resolves.toMatchObject({ eligible: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: `pdf-workspace:${command}` });
  });

  it('结构化返回非 PDF 互斥状态', async () => {
    const api = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: { eligible: false, enabled: false, url: 'https://x.test/' } }) } };
    await expect(sendPdfWorkspaceCommand('status', api)).resolves.toMatchObject({ eligible: false, enabled: false });
  });
});
