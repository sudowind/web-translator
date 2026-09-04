import { describe, expect, it, vi } from 'vitest';
import { isOutputFormatUnsupported } from '../../../../src/providers/openai/output-format-error';
import { OpenAiTranslationClient } from '../../../../src/providers/openai/client';
import { defaultOpenAiSettings } from '../../../../src/settings/schema';

describe('结构化输出能力拒绝', () => {
  it.each([
    { code: 'unsupported_parameter', param: 'response_format' },
    { code: 'unsupported_value', param: 'response_format.type' },
    { code: 'InvalidParameter', message: 'response_format json_schema is not supported by this model' },
  ])('明确拒绝才识别：%j', async (error) => {
    expect(await isOutputFormatUnsupported(Response.json({ error }, { status: 400 }))).toBe(true);
  });
  it.each([
    { status: 400, error: { message: 'Bad request' } },
    { status: 400, error: { message: 'Invalid schema for response_format: required property missing' } },
    { status: 400, error: { code: 'unsupported_parameter', param: 'temperature' } },
    { status: 400, error: { message: 'json_schema: additionalProperties keyword not supported' } },
    { status: 400, error: { code: 'invalid_request_error', param: 'response_format', message: 'response_format json_schema: array items type is not supported' } },
    { status: 400, error: { message: 'json_schema: minLength keyword not supported' } },
    { status: 400, error: { message: 'json_schema: object nesting is not supported' } },
    { status: 400, error: { param: 'response_format', code: 'invalid_request_error', message: 'Unsupported schema in response_format: type null is not permitted' } },
    { status: 400, error: { param: 'response_format.json_schema.schema', message: 'json_schema: minLength keyword not supported' } },
    { status: 400, error: { param: 'response_format.json_schema.schema', message: 'json_schema not supported' } },
    { status: 401, error: { message: 'json_schema unsupported' } },
    { status: 429, error: { message: 'json_schema unsupported' } },
    { status: 500, error: { message: 'json_schema unsupported' } },
  ])('不降级：%j', async ({ status, error }) => {
    expect(await isOutputFormatUnsupported(Response.json({ error }, { status }))).toBe(false);
  });
  it('畸形或超大正文不判定为不支持', async () => {
    expect(await isOutputFormatUnsupported(new Response('not JSON', { status: 400 }))).toBe(false);
    expect(await isOutputFormatUnsupported(Response.json({ error: { message: 'json_schema unsupported' + 'x'.repeat(16384) } }, { status: 400 }))).toBe(false);
  });
  it('正式严格翻译保留稳定错误码，不自动重试或泄露正文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'unsupported_value', param: 'response_format.type', message: 'secret' } }, { status: 422 }));
    const client = new OpenAiTranslationClient({ ...defaultOpenAiSettings, baseUrl: 'https://proxy.example/v1', apiKey: 'secret', defaultModel: 'any', translation: { ...defaultOpenAiSettings.translation, outputMode: 'json_schema' } }, fetcher);
    await expect(client.translate({ sourceLanguage: 'en', targetLanguage: 'zh', blocks: [{ id: '1', text: 'Hello' }] })).rejects.toMatchObject({ code: 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED', message: 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
