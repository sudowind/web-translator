export class SseResponseError extends Error {
  readonly name = 'SseResponseError';
}

export async function readChatCompletionSse(
  response: Response,
  onActivity: () => void,
  onDelta?: (delta: string) => void,
): Promise<string> {
  if (!response.body) throw new SseResponseError('SSE_BODY_MISSING');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        throw new SseResponseError('SSE_EVENT_INVALID');
      }

      const delta = readDelta(event);
      onActivity();
      if (delta !== undefined) {
        content += delta;
        if (delta) onDelta?.(delta);
      }
    }
  }

  if (!content) throw new SseResponseError('SSE_CONTENT_MISSING');
  return content;
}

function readDelta(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new SseResponseError('SSE_EVENT_INVALID');
  }
  if (value.choices.length === 0) return undefined;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) {
    throw new SseResponseError('SSE_EVENT_INVALID');
  }
  const content = first.delta.content;
  if (content === undefined || content === null) return undefined;
  if (typeof content !== 'string') throw new SseResponseError('SSE_EVENT_INVALID');
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
