import { describe, expect, it } from 'vitest';

import { TranslationProviderError } from '../../../src/providers/openai/client';
import { classifyTranslationFailure, formatTranslationFailure } from '../../../src/translation/failure';

describe('翻译失败诊断', () => {
  it('保留超时和 HTTP 限流错误', () => {
    expect(classifyTranslationFailure(
      new TranslationProviderError('TRANSLATION_TIMEOUT'),
      { attempts: 1, durationMs: 30_002, model: 'qwen-plus', occurredAt: 100 },
    )).toMatchObject({
      code: 'TRANSLATION_TIMEOUT', category: 'timeout', retryable: true, attempts: 1,
    });
    expect(classifyTranslationFailure(
      new TranslationProviderError('TRANSLATION_HTTP_429'),
      { attempts: 3, durationMs: 4_100, model: 'qwen-plus', occurredAt: 100 },
    )).toMatchObject({
      category: 'rate-limit', httpStatus: 429, retryable: true,
    });
  });

  it('结构化输出错误具有可读摘要且复制内容只包含白名单字段', () => {
    const failure = classifyTranslationFailure(
      new TranslationProviderError('TRANSLATION_JSON_INVALID'),
      { attempts: 1, durationMs: 800, model: 'qwen-plus', occurredAt: 100 },
    );
    expect(failure).toMatchObject({ category: 'response-format', summary: '模型返回的 JSON 无法解析' });
    const text = formatTranslationFailure(failure);
    expect(text).toContain('TRANSLATION_JSON_INVALID');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('论文原文');
  });
});
