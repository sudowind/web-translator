// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings } from '../../../src/settings/schema';
import { getSettings, saveSettings } from '../../../src/settings/store';
import App, { type SettingsSection } from '../../../entrypoints/options/App';

describe('服务独立保存', () => {
  it.each<SettingsSection>(['all', 'pdf'])('%s 页面只配置 MinerU 后保存并重新读取', async (section) => {
    fakeBrowser.reset();
    await saveSettings({ ...defaultSettings, mineru: { ...defaultSettings.mineru, token: ' mineru-test-token ' } });
    const request = vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation(async () => true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<App section={section} />); });
      const form = container.querySelector('form')!;
      expect(form.checkValidity()).toBe(true);
      await act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
      expect(container.textContent).toContain('设置已保存；翻译和论文问答需另行配置 LLM API Key');
      const saved = await getSettings();
      expect(saved.openAi.apiKey).toBe('');
      expect(saved.mineru.token).toBe('mineru-test-token');
      expect(request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://mineru.net/*', 'https://cdn-mineru.openxlab.org.cn/*'] });
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
