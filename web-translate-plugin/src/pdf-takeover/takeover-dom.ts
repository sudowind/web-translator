export function mountProbeSurface() {
  const previous = document.documentElement.innerHTML;
  sessionStorage.setItem('web-translate:probe:previous', previous);
  document.documentElement.innerHTML =
    '<head><title>PDF 接管探针</title></head><body><main id="web-translate-probe-root" data-renderer="pdfjs-probe">PDF.js 接管测试界面</main></body>';
  return {
    href: location.href,
    injected: document.getElementById('web-translate-probe-root') !== null,
  };
}

export function restoreProbeSurface() {
  const previous = sessionStorage.getItem('web-translate:probe:previous');
  if (previous === null) return false;
  document.documentElement.innerHTML = previous;
  sessionStorage.removeItem('web-translate:probe:previous');
  return true;
}
