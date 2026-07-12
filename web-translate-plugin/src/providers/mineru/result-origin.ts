import { MineruError } from './contracts';

export const MINERU_RESULT_ORIGIN = 'https://cdn-mineru.openxlab.org.cn';
export const MINERU_RESULT_ORIGIN_PATTERN = `${MINERU_RESULT_ORIGIN}/*`;

export function validateMineruResultUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MineruError('MINERU_RESULT_ORIGIN_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== MINERU_RESULT_ORIGIN ||
    url.username ||
    url.password
  ) {
    throw new MineruError('MINERU_RESULT_ORIGIN_INVALID');
  }
  return url.href;
}
