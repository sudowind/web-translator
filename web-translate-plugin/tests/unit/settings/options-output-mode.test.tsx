// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings } from '../../../src/settings/schema';

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn(), getCapability: vi.fn() }));
vi.mock('../../../src/settings/store', () => ({ getSettings: mocks.getSettings, saveSettings: mocks.saveSettings }));
vi.mock('../../../src/settings/translation-capabilities', () => ({ getTranslationCapability: mocks.getCapability }));
import App from '../../../entrypoints/options/App';

describe('输出模式交互', () => {
  it('传递所选模式，测试期间禁止编辑，完成后显示能力且不自动保存设置', async () => {
    fakeBrowser.reset();
    mocks.getSettings.mockResolvedValue({ ...defaultSettings, openAi: { ...defaultSettings.openAi, apiKey: 'secret', baseUrl: 'https://proxy.example/v1', defaultModel: 'any-model' } });
    mocks.getCapability.mockResolvedValue(undefined);
    vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation(async () => true);
    let finish!: (value: unknown) => void;
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<App section="translation" />); });
      const select = container.querySelector<HTMLSelectElement>('#translation-output-mode')!;
      expect(select.value).toBe('auto');
      await act(async () => { select.value = 'json_schema'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      const testButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '测试翻译配置')!;
      await act(async () => { testButton.click(); });
      expect(select.closest('fieldset')?.disabled).toBe(true);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'translation', settings: expect.objectContaining({ openAi: expect.objectContaining({ translation: expect.objectContaining({ outputMode: 'json_schema' }) }) }) }));
      mocks.getCapability.mockResolvedValue({ format: 'json_schema', testedAt: Date.now() });
      await act(async () => { finish({ ok: true, value: { connected: true, outputFormat: 'json_schema', downgraded: false } }); });
      expect(select.closest('fieldset')?.disabled).toBe(false);
      expect(container.textContent).toContain('严格 Schema请求及译文校验通过');
      expect(container.textContent).toContain('最近验证通过：严格 Schema');
      expect(mocks.saveSettings).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
