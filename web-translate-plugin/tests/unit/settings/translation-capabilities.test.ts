import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultOpenAiSettings } from '../../../src/settings/schema';
import { CAPABILITY_TTL_MS, getTranslationCapability, resolveTranslationOutputFormat, setTranslationCapability, translationCapabilityKey } from '../../../src/settings/translation-capabilities';
import { isSettingsTestLlmMessage, testLlmConfiguration } from '../../../src/settings/test-provider';
import { OpenAiTranslationClient } from '../../../src/providers/openai/client';

const settings = { openAi: { ...defaultOpenAiSettings, apiKey: 'secret', baseUrl: 'https://proxy.example/v1', defaultModel: 'any-model' }, sourceLanguage: 'en', targetLanguage: 'zh-CN' };
const clientsFor = (translate = vi.fn().mockResolvedValue([])) => ({
  createTranslation: vi.fn((_settings: typeof settings.openAi) => ({ translate })),
  createChat: () => ({ complete: vi.fn() }), createAgent: () => ({ ask: vi.fn() }),
});
beforeEach(() => fakeBrowser.reset());

describe('翻译输出能力', () => {
  it('规范化尾斜杠；按 endpoint/model/dialect 隔离，不存储凭据', async () => {
    const key = await translationCapabilityKey(settings.openAi);
    expect(await translationCapabilityKey({ ...settings.openAi, baseUrl: 'https://proxy.example/v1/', apiKey: 'different' })).toBe(key);
    await setTranslationCapability(settings.openAi, 'json_schema');
    expect(await resolveTranslationOutputFormat(settings.openAi)).toBe('json_schema');
    for (const change of [{ baseUrl: 'https://another.example/v1' }, { defaultModel: 'other' }, { dialect: 'dashscope' as const }]) {
      expect(await resolveTranslationOutputFormat({ ...settings.openAi, ...change })).toBe('json_object');
    }
    const stored = JSON.stringify(await fakeBrowser.storage.local.get(null));
    expect(stored).not.toContain('secret');
    expect(stored).not.toContain('proxy.example');
  });

  it('过期记录失效、显式模式优先、损坏缓存安全回退', async () => {
    await setTranslationCapability(settings.openAi, 'json_schema', 1000);
    expect(await getTranslationCapability(settings.openAi, 1000 + CAPABILITY_TTL_MS)).toBeUndefined();
    await setTranslationCapability(settings.openAi, 'json_schema');
    expect(await resolveTranslationOutputFormat({ ...settings.openAi, translation: { ...settings.openAi.translation, outputMode: 'json_object' } })).toBe('json_object');
    await fakeBrowser.storage.local.set({ 'translation-output-capabilities-v1': [null, {}, { format: 'json_schema', key: 'invalid', testedAt: Date.now() }] });
    expect(await resolveTranslationOutputFormat(settings.openAi)).toBe('json_object');
  });

  it('容量最多 32 项且并发写入不覆盖其他记录', async () => {
    await Promise.all(Array.from({ length: 35 }, (_, i) => setTranslationCapability({ ...settings.openAi, defaultModel: `model-${i}` }, 'json_schema')));
    const stored = await fakeBrowser.storage.local.get('translation-output-capabilities-v1');
    expect(stored['translation-output-capabilities-v1']).toHaveLength(32);
  });

  it('自动测试严格协议并记录成功结果，正式翻译复用且仍校验 SSE', async () => {
    const clients = clientsFor();
    await expect(testLlmConfiguration(settings, 'translation', clients)).resolves.toEqual({ connected: true, outputFormat: 'json_schema', downgraded: false });
    expect(clients.createTranslation.mock.calls[0][0].translation.outputMode).toBe('json_schema');
    const content = JSON.stringify({ translations: [{ id: 'b1', text: '你好' }] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`));
    await expect(new OpenAiTranslationClient(settings.openAi, fetcher).translate({ sourceLanguage: 'en', targetLanguage: 'zh-CN', blocks: [{ id: 'b1', text: 'Hello' }] })).resolves.toEqual([{ id: 'b1', text: '你好' }]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).response_format.type).toBe('json_schema');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('明确不支持时最多降级一次，并记录通过的 JSON 模式', async () => {
    const translate = vi.fn().mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code: 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED' })).mockResolvedValueOnce([]);
    const clients = clientsFor(translate);
    await expect(testLlmConfiguration(settings, 'translation', clients)).resolves.toMatchObject({ outputFormat: 'json_object', downgraded: true });
    expect(clients.createTranslation.mock.calls.map(([value]) => value.translation.outputMode)).toEqual(['json_schema', 'json_object']);
    expect(await getTranslationCapability(settings.openAi)).toMatchObject({ format: 'json_object' });
  });

  it('真实客户端的 HTTP 拒绝和 SSE 回退串联成功，失败回退不写入能力', async () => {
    const content = JSON.stringify({ translations: [{ id: 'provider-connection-test', text: '你好' }] });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'unsupported_value', param: 'response_format.type' } }, { status: 400 }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`));
    const clients = { ...clientsFor(), createTranslation: (value: typeof settings.openAi) => new OpenAiTranslationClient(value, fetcher) };
    await expect(testLlmConfiguration(settings, 'translation', clients)).resolves.toMatchObject({ outputFormat: 'json_object', downgraded: true });
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).response_format.type)).toEqual(['json_schema', 'json_object']);
    const translate = vi.fn().mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED' }));
    await expect(testLlmConfiguration(settings, 'translation', clientsFor(translate))).rejects.toThrow();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(await getTranslationCapability(settings.openAi)).toBeUndefined();
  });

  it('相同连接的并发测试只运行一个探针', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const translate = vi.fn(() => { started(); return new Promise<void>((resolve) => { finish = resolve; }); });
    const clients = clientsFor(translate);
    const first = testLlmConfiguration(settings, 'translation', clients);
    await ready;
    try {
      await expect(testLlmConfiguration(settings, 'translation', clients)).rejects.toThrow();
      expect(translate).toHaveBeenCalledTimes(1);
    } finally { finish(); }
    await first;
  });

  it.each(['TRANSLATION_HTTP_400', 'TRANSLATION_HTTP_401', 'TRANSLATION_HTTP_429', 'TRANSLATION_TIMEOUT', 'TRANSLATION_SCHEMA_INVALID', 'TRANSLATION_ID_MISSING'])('%s 不降级、不保留旧成功记录', async (code) => {
    await setTranslationCapability(settings.openAi, 'json_schema');
    const translate = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }));
    await expect(testLlmConfiguration(settings, 'translation', clientsFor(translate))).rejects.toThrow();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(await getTranslationCapability(settings.openAi)).toBeUndefined();
  });

  it('显式严格模式不降级，拒绝额外能力字段和无效模式', async () => {
    const explicit = { ...settings, openAi: { ...settings.openAi, translation: { ...settings.openAi.translation, outputMode: 'json_schema' as const } } };
    const message = { type: 'settings:test-llm', purpose: 'translation', settings: explicit };
    expect(isSettingsTestLlmMessage(message)).toBe(true);
    for (const patch of [{ capability: true }, { outputMode: 'invalid' }]) {
      expect(isSettingsTestLlmMessage({ ...message, settings: { ...explicit, openAi: { ...explicit.openAi, translation: { ...explicit.openAi.translation, ...patch } } } })).toBe(false);
    }
    const translate = vi.fn().mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED' }));
    await expect(testLlmConfiguration(explicit, 'translation', clientsFor(translate))).rejects.toThrow('不支持严格 Schema');
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
