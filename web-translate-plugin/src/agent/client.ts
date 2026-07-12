import { LlmProviderError, OpenAiChatClient } from '../providers/openai/chat-client';
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
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    try {
      return await new OpenAiChatClient(this.settings, this.fetcher).complete(
        {
          purpose: 'agent',
          messages: [
            {
              role: 'system',
              content: '仅根据所给论文上下文回答；每个事实必须带 [p:N] 页码引用，不得编造页码。',
            },
            ...context.recentMessages,
            { role: 'user', content: `论文上下文：\n${context.text}\n\n问题：${question}` },
          ],
        },
        signal,
        onDelta,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof LlmProviderError) throw mapProviderError(error);
      throw error;
    }
  }
}

function mapProviderError(error: LlmProviderError): AgentProviderError {
  const status = /^LLM_HTTP_(\d+)$/.exec(error.code)?.[1];
  if (status) return new AgentProviderError(`AGENT_HTTP_${status}`);
  if (error.code === 'LLM_RESPONSE_INVALID') return new AgentProviderError('AGENT_RESPONSE_INVALID');
  if (error.code === 'LLM_TIMEOUT') return new AgentProviderError('AGENT_TIMEOUT');
  return new AgentProviderError('AGENT_NETWORK');
}
