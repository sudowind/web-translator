import { describe, expect, it } from 'vitest';

import { safeErrorCode } from '../../live/live-report';

describe('在线验收脱敏报告', () => {
  it.each([
    ['MINERU_TIMEOUT'],
    ['PDF_SIGNATURE_INVALID'],
    ['TRANSLATION_TIMEOUT'],
    ['LLM_RESPONSE_INVALID'],
  ])('保留稳定错误码 %s', (code) => {
    expect(safeErrorCode({ code, privateDetail: 'must-not-leak' })).toBe(code);
  });

  it('原始错误文本只返回未知错误', () => {
    expect(safeErrorCode(new Error('private raw response body'))).toBe(
      'UNKNOWN_ERROR',
    );
  });

  it('拒绝伪装成错误码的敏感文本', () => {
    expect(safeErrorCode({ code: 'MINERU_TOKEN_private' })).toBe('UNKNOWN_ERROR');
  });
});
