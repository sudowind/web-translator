import type { OpenAiSettings } from '../../settings/schema';
import {
  buildChatRequest,
  type ChatMessage,
  type LlmPurpose,
} from './request-builder';
import { readChatCompletionSse, SseResponseError } from './sse';

export class LlmProviderError extends Error {
  readonly name = 'LlmProviderError';

  constructor(readonly code: string) {
    super(code);
  }
}

export interface CompleteChatInput {
  purpose: LlmPurpose;
  messages: ChatMessage[];
}

export class OpenAiChatClient {
  constructor(
    private readonly settings: OpenAiSettings,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async complete(input: CompleteChatInput, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const { body, timeoutMs } = buildChatRequest({ ...input, settings: this.settings });
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };
    armTimeout();

    try {
      const fetcher = this.fetcher;
      const response = await fetcher(
        `${this.settings.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.settings.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new LlmProviderError(`LLM_HTTP_${response.status}`);

      if (body.stream === true) {
        armTimeout();
        return await readChatCompletionSse(response, armTimeout);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LlmProviderError('LLM_RESPONSE_INVALID');
      }
      const content = readContent(payload);
      if (content === undefined) throw new LlmProviderError('LLM_RESPONSE_INVALID');
      return content;
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if (timedOut) throw new LlmProviderError('LLM_TIMEOUT');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof SseResponseError) {
        throw new LlmProviderError('LLM_RESPONSE_INVALID');
      }
      throw new LlmProviderError('LLM_NETWORK');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function readContent(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}
