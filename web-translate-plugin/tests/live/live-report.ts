export function safeErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === 'string' &&
    /^(PDF|MINERU|TRANSLATION|LLM)_[A-Z0-9_]+$/.test(code)
    ? code
    : 'UNKNOWN_ERROR';
}
