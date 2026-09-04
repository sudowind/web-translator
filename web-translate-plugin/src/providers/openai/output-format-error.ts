/** 仅识别明确的输出格式能力拒绝；正文只短暂驻留内存，不进入诊断。 */
export async function isOutputFormatUnsupported(response: Response): Promise<boolean> {
  if (![400, 422].includes(response.status) || !response.body) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) return false;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const error: unknown = JSON.parse(body)?.error;
    if (!error || typeof error !== 'object') return false;
    const { code, param, message } = error as Record<string, unknown>;
    const text = typeof message === 'string' ? message : '';
    const formatParam = typeof param === 'string' && /^(response_format(?:\.type)?|json_schema)$/.test(param);
    if (typeof param === 'string' && /^(response_format\.json_schema\.|json_schema\.)/.test(param)) return false;
    const unsupportedCode = code === 'unsupported_parameter' || code === 'unsupported_value';
    // Schema 定义错误不能被当成接口缺少能力。
    if (/invalid schema|schema validation|additionalProperties|required propert|\b(keyword|items|properties|minLength|maxLength|anyOf|oneOf|allOf)\b/i.test(text)) return false;
    // 只接受主语明确为协议字段/格式的句子，不能仅因两组词同时出现就降级。
    const normalized = text.replace(/["'`]/g, '').trim();
    const format = '(?:response_format(?:\\.type)?(?: (?:of )?type)?[ :=]*json_schema|json_schema|response_format(?:\\.type)?)';
    const unsupportedMessage = new RegExp(`^(?:the )?${format} (?:is )?(?:not supported|unsupported|not available)(?: (?:by|for|with|on|in) (?:this |the |current )?(?:model|endpoint|api|deployment|region)\\b[^.!]*)?[.!]?$`, 'i').test(normalized)
      || new RegExp(`^(?:this |the |current )?(?:model|endpoint|api|deployment) does not support (?:the )?${format}[.!]?$`, 'i').test(normalized);
    return (formatParam && unsupportedCode) || unsupportedMessage;
  } catch {
    return false;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
