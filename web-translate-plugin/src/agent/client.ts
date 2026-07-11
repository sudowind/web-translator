import type { OpenAiSettings } from '../settings/schema';
import type { AgentContext } from './context-builder';

export class AgentProviderError extends Error {
  readonly name = 'AgentProviderError';

  constructor(readonly code: string) {
    super(code);
  }
}

export class OpenAiPaperAgentClient {
  constructor(
    private readonly settings: OpenAiSettings,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async ask(
    context: AgentContext,
    question: string,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const fetcher = this.fetcher;
    let response: Response;
    try {
      response = await fetcher(`${this.settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            { role: 'system', content: '仅根据所给论文上下文回答；每个事实必须带 [p:N] 页码引用，不得编造页码。' },
            ...context.recentMessages,
            { role: 'user', content: `论文上下文：\n${context.text}\n\n问题：${question}` },
          ],
        }),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new AgentProviderError('AGENT_NETWORK');
    }
    if (!response.ok) throw new AgentProviderError(`AGENT_HTTP_${response.status}`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new AgentProviderError('AGENT_RESPONSE_INVALID'); }
    const content = readContent(payload);
    if (content === undefined) throw new AgentProviderError('AGENT_RESPONSE_INVALID');
    return content;
  }
}

function readContent(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || typeof choices[0] !== 'object' || choices[0] === null) return undefined;
  const message = (choices[0] as { message?: unknown }).message;
  return typeof message === 'object' && message !== null && typeof (message as { content?: unknown }).content === 'string'
    ? (message as { content: string }).content
    : undefined;
}
