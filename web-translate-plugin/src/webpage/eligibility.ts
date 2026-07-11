const SENSITIVE_PATH =
  /(?:^|[./_-])(password|checkout|payment|billing|admin|administrator)(?:[./_-]|$)/i;

export function isEligiblePage(url: string, document: Document): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  const locationText = `${parsed.hostname}${pathname}`;
  if (SENSITIVE_PATH.test(locationText)) {
    return false;
  }

  return document.querySelector('input[type="password"]') === null;
}
