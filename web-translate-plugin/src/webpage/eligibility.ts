const SENSITIVE_PATH =
  /(?:^|[./_-])(passwords?|checkouts?|payments?|billing(?:portal)?s?|admins?|administration|administrator)(?:[./_-]|$)/i;

export function isEligiblePage(url: URL, document: Document): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (/\.pdf$/i.test(pathname) || /(?:^|\/)pdf(?:\/|$)/i.test(pathname)) {
    return false;
  }
  const locationText = `${url.hostname}${pathname}`;
  if (SENSITIVE_PATH.test(locationText)) {
    return false;
  }

  return document.querySelector('input[type="password"]') === null;
}
