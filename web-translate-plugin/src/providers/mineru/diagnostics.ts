import { MineruError } from './contracts';

// 只传播稳定错误码，不记录服务端正文、Token、文件地址或签名下载链接。
const apiErrors: Record<string, string> = {
  A0202: 'MINERU_TOKEN_INVALID', A0211: 'MINERU_TOKEN_EXPIRED',
  '-60005': 'MINERU_FILE_TOO_LARGE', '-60006': 'MINERU_TOO_MANY_PAGES',
  '-60008': 'MINERU_SOURCE_TIMEOUT', '-60009': 'MINERU_QUEUE_FULL',
  '-60018': 'MINERU_QUOTA_EXCEEDED', '-60019': 'MINERU_QUOTA_EXCEEDED',
};

export function mineruApiError(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? Object.hasOwn(apiErrors, String(value)) ? apiErrors[String(value)] : undefined
    : undefined;
}

export function mineruErrorCode(error: unknown, fallback: string): string {
  if (!(error instanceof MineruError) || !/^MINERU_[A-Z0-9_]+$/.test(error.code)) return fallback;
  return Number.isInteger(error.status) && error.status! >= 400 && error.status! <= 599
    ? `${error.code}_${error.status}` : error.code;
}

export function stopsMineruFallback(error: unknown): boolean {
  return error instanceof MineruError && (
    error.status === 401 || error.status === 403 || error.status === 429 ||
    ['MINERU_TOKEN_INVALID', 'MINERU_TOKEN_EXPIRED', 'MINERU_QUOTA_EXCEEDED',
      'MINERU_FILE_TOO_LARGE', 'MINERU_TOO_MANY_PAGES', 'MINERU_QUEUE_FULL'].includes(error.code)
  );
}

const explanations: Record<string, string> = {
  MINERU_TOKEN_INVALID: 'Token 无效，请在 PDF 解析设置中填写原始 Token，不要添加 Bearer 前缀',
  MINERU_TOKEN_EXPIRED: 'Token 已过期，请更新 PDF 解析设置中的 Token',
  MINERU_QUOTA_EXCEEDED: 'MinerU 解析额度已用尽，请检查账户额度后重试',
  MINERU_FILE_TOO_LARGE: '文件超过 MinerU 大小限制，请缩小文件后重试',
  MINERU_TOO_MANY_PAGES: '文件页数超过 MinerU 限制，请拆分后重试',
  MINERU_SOURCE_TIMEOUT: 'MinerU 读取 PDF 地址超时，请检查文件是否可以公开访问',
  MINERU_QUEUE_FULL: 'MinerU 任务队列已满，请稍后重试',
  MINERU_NOT_CONFIGURED: '尚未保存 MinerU Token，请先在 PDF 解析设置中配置',
  MINERU_TIMEOUT: '等待 MinerU 解析结果超时，请稍后重试',
  MINERU_RESULT_NETWORK: '解析结果下载失败，请检查代理是否能访问 cdn-mineru.openxlab.org.cn，以及扩展的站点访问权限',
  MINERU_RESULT_ORIGIN_INVALID: '结果下载地址不在允许的 MinerU 域名中，请反馈此错误码',
  MINERU_ZIP_INVALID: 'MinerU 返回的结果压缩包无效，请重试解析',
  MINERU_CONTENT_LIST_MISSING: 'MinerU 结果缺少内容列表，请反馈此错误码',
};

export function mineruFailureFeedback(error: unknown): { code: string; message: string } {
  const value = error instanceof Error ? error.message : '';
  const code = /^(MINERU|PDF)_[A-Z0-9_]{1,100}$/.test(value) ? value : 'MINERU_PARSE_FAILED';
  const base = code.replace(/_[45]\d\d$/, '');
  const status = code.match(/_([45]\d\d)$/)?.[1];
  const reason = explanations[base] ?? (
    status && base === 'MINERU_RESULT_HTTP' ? `结果下载返回 HTTP ${status}，请检查下载地址是否过期或访问受限` :
    status && base === 'MINERU_UPLOAD_HTTP' ? `文件上传返回 HTTP ${status}，请重新获取上传地址后重试` :
    status === '401' ? '服务拒绝认证，请检查 MinerU Token 是否有效或已过期' :
    status === '403' ? '服务拒绝访问，请检查账户权限及请求的服务地址' :
    status === '429' ? '请求受限，请检查 MinerU 额度或稍后重试' :
    status ? `服务请求返回 HTTP ${status}，请查看扩展后台的 Network 记录` :
    code.endsWith('_NETWORK') ? '网络请求失败，请检查网络、代理和扩展站点访问权限' :
    '请查看扩展后台的 Network 记录以确认具体原因'
  );
  return { code, message: `MinerU 解析失败：${reason}（${code}）；左栏不受影响` };
}
