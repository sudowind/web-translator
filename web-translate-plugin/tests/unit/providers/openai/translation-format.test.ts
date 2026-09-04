import { describe, expect, it } from 'vitest';
import { buildTranslationResponseFormat } from '../../../../src/providers/openai/translation-format';
import { defaultOpenAiSettings } from '../../../../src/settings/schema';

describe('通用翻译输出模式', () => {
  it.each(['json_schema', 'json_object', 'auto'] as const)('任意模型与 endpoint 按 %s 配置选择协议', (outputMode) => {
    const result = buildTranslationResponseFormat({
      ...defaultOpenAiSettings, baseUrl: 'https://proxy.example/v1', defaultModel: 'arbitrary-model',
      translation: { ...defaultOpenAiSettings.translation, outputMode },
    });
    expect(result.type).toBe(outputMode === 'json_schema' ? 'json_schema' : 'json_object');
  });
  it('百炼模型名不再隐式开启严格模式', () => {
    expect(buildTranslationResponseFormat({ ...defaultOpenAiSettings, dialect: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.8-max',
    }).type).toBe('json_object');
  });
});
