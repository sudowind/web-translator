import { describe, expect, it } from 'vitest';
import { MineruError } from '../../../../src/providers/mineru/contracts';
import { mineruApiError, mineruErrorCode, mineruFailureFeedback, stopsMineruFallback } from '../../../../src/providers/mineru/diagnostics';

describe('MinerU 脱敏诊断', () => {
  it('只映射已知服务错误，不传播任意服务端文字', () => {
    expect(mineruApiError('A0211')).toBe('MINERU_TOKEN_EXPIRED');
    expect(mineruApiError(-60018)).toBe('MINERU_QUOTA_EXCEEDED');
    expect(mineruApiError('secret-token')).toBeUndefined();
    expect(mineruApiError('toString')).toBeUndefined();
  });
  it('保留 HTTP 状态但丢弃未知异常正文', () => {
    expect(mineruErrorCode(new MineruError('MINERU_POLL_HTTP', 403), 'fallback')).toBe('MINERU_POLL_HTTP_403');
    expect(mineruErrorCode(new Error('secret-token'), 'fallback')).toBe('fallback');
    expect(mineruFailureFeedback(new Error('secret-token https://signed.test/?secret=1')).message).not.toContain('secret');
    expect(mineruFailureFeedback(new Error('MINERU_POLL_HTTP_403')).message).toContain('服务拒绝访问');
    expect(mineruFailureFeedback(new Error('MINERU_TOKEN_EXPIRED_401')).message).toContain('Token 已过期');
  });
  it('结果下载失败指向 CDN 网络或下载链接，不误导为 API Token 失败', () => {
    expect(mineruFailureFeedback(new Error('MINERU_RESULT_NETWORK')).message).toContain('cdn-mineru.openxlab.org.cn');
    expect(mineruFailureFeedback(new Error('MINERU_RESULT_HTTP_401')).message).toContain('下载地址');
    expect(mineruFailureFeedback(new Error('MINERU_RESULT_HTTP_401')).message).not.toContain('Token');
  });
  it('认证和额度失败停止回退，文件访问失败仍可回退', () => {
    expect(stopsMineruFallback(new MineruError('MINERU_CREATE_HTTP', 401))).toBe(true);
    expect(stopsMineruFallback(new MineruError('MINERU_QUOTA_EXCEEDED'))).toBe(true);
    expect(stopsMineruFallback(new MineruError('MINERU_SOURCE_TIMEOUT'))).toBe(false);
  });
});
