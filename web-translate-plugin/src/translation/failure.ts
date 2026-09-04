export type TranslationFailureCategory =
  | 'timeout'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'response-format'
  | 'configuration'
  | 'unknown';

export interface TranslationFailure {
  code: string;
  category: TranslationFailureCategory;
  summary: string;
  retryable: boolean;
  attempts: number;
  durationMs: number;
  httpStatus?: number;
  provider: 'openai-compatible';
  model: string;
  occurredAt: number;
}

interface FailureMetadata {
  attempts: number;
  durationMs: number;
  model: string;
  occurredAt?: number;
}

const responseSummaries: Record<string, string> = {
  TRANSLATION_JSON_INVALID: '模型返回的 JSON 无法解析',
  TRANSLATION_SCHEMA_INVALID: '模型返回的数据结构不符合要求',
  TRANSLATION_ID_UNKNOWN: '模型返回了未知的译文块',
  TRANSLATION_ID_DUPLICATE: '模型返回了重复的译文块',
  TRANSLATION_ID_MISSING: '模型返回的译文块不完整',
  TRANSLATION_RESPONSE_INVALID: '兼容接口响应缺少有效内容',
};

export function classifyTranslationFailure(error: unknown, metadata: FailureMetadata): TranslationFailure {
  const code = readTranslationCode(error);
  const httpStatus = readHttpStatus(code);
  const category = categoryFor(code, httpStatus);
  return {
    code,
    category,
    summary: summaryFor(code, category, httpStatus),
    retryable: category !== 'configuration',
    attempts: metadata.attempts,
    durationMs: Math.max(0, Math.round(metadata.durationMs)),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    provider: 'openai-compatible',
    model: metadata.model,
    occurredAt: metadata.occurredAt ?? Date.now(),
  };
}

export function formatTranslationFailure(failure: TranslationFailure): string {
  return JSON.stringify({
    code: failure.code,
    category: failure.category,
    summary: failure.summary,
    retryable: failure.retryable,
    attempts: failure.attempts,
    durationMs: failure.durationMs,
    ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
    provider: failure.provider,
    model: failure.model,
    occurredAt: new Date(failure.occurredAt).toISOString(),
  }, null, 2);
}

function readTranslationCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && /^TRANSLATION_[A-Z0-9_]+$/.test(code)) return code;
    const status = 'status' in error ? (error as { status?: unknown }).status : undefined;
    if (typeof status === 'number' && Number.isInteger(status)) return `TRANSLATION_HTTP_${status}`;
  }
  const message = error instanceof Error ? error.message : '';
  return /^TRANSLATION_[A-Z0-9_]+$/.test(message) ? message : 'TRANSLATION_FAILED';
}

function readHttpStatus(code: string): number | undefined {
  const match = /^TRANSLATION_HTTP_(\d{3})$/.exec(code);
  return match ? Number(match[1]) : undefined;
}

function categoryFor(code: string, status?: number): TranslationFailureCategory {
  if (code === 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED') return 'configuration';
  if (code === 'TRANSLATION_TIMEOUT') return 'timeout';
  if (status === 429) return 'rate-limit';
  if (status !== undefined && status >= 500) return 'server';
  if (code === 'TRANSLATION_NETWORK') return 'network';
  if (code in responseSummaries) return 'response-format';
  if (status === 401 || status === 403 || code === 'TRANSLATION_NOT_CONFIGURED') return 'configuration';
  return 'unknown';
}

function summaryFor(code: string, category: TranslationFailureCategory, status?: number): string {
  if (code === 'TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED') return '接口不支持当前翻译输出模式，请在设置中重新测试或选择 JSON 模式';
  if (code in responseSummaries) return responseSummaries[code];
  if (category === 'timeout') return '请求超时';
  if (category === 'rate-limit') return '接口限流';
  if (category === 'server') return `接口临时不可用${status ? `（HTTP ${status}）` : ''}`;
  if (category === 'network') return '网络连接失败';
  if (category === 'configuration') return `接口鉴权或配置错误${status ? `（HTTP ${status}）` : ''}`;
  return '翻译请求失败';
}
