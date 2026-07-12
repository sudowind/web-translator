import { LlmProviderError, OpenAiChatClient } from './chat-client';
import type {
  OpenAiSettings,
  TranslationRequest,
  TranslationResult,
} from './contracts';
import {
  parseTranslationResponse,
  TranslationProviderError,
} from './translation-response';

export { TranslationProviderError } from './translation-response';

export class OpenAiTranslationClient {
  constructor(
    private readonly settings: OpenAiSettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult[]> {
    const { apiKey, baseUrl, defaultModel } = this.settings;
    if (!apiKey.trim() || !baseUrl.trim() || !defaultModel.trim()) {
      throw new Error('翻译 Provider 配置不完整');
    }

    const requestIds = new Set<string>();
    for (const { id } of request.blocks) {
      if (requestIds.has(id)) throw new Error(`翻译请求包含重复 id: ${id}`);
      requestIds.add(id);
    }

    let content: string;
    try {
      content = await new OpenAiChatClient(this.settings, this.fetcher).complete(
        {
          purpose: 'translation',
          messages: [
            {
              role: 'system',
              content:
                `Translate each block from ${request.sourceLanguage} to ${request.targetLanguage}. ` +
                'Return one JSON object with a translations array. Preserve every id exactly once; never merge or split blocks. ' +
                'Preserve Markdown structure, inline/display math delimiters, code fences and table rows/columns. ' +
                'Do not translate math expressions. For table blocks, return a Markdown table.',
            },
            { role: 'user', content: JSON.stringify({ blocks: request.blocks }) },
          ],
        },
        signal,
      );
    } catch (error) {
      if (error instanceof LlmProviderError) {
        const status = /^LLM_HTTP_(\d+)$/.exec(error.code)?.[1];
        if (status) throw new TranslationProviderError(`TRANSLATION_HTTP_${status}`);
        if (error.code === 'LLM_TIMEOUT') {
          throw new TranslationProviderError('TRANSLATION_TIMEOUT');
        }
        if (error.code === 'LLM_RESPONSE_INVALID') {
          throw new TranslationProviderError('TRANSLATION_RESPONSE_INVALID');
        }
        throw new TranslationProviderError('TRANSLATION_NETWORK');
      }
      throw error;
    }

    return parseTranslationResponse(
      content,
      request.blocks.map(({ id }) => id),
    );
  }
}

export type {
  TranslationBlockInput,
  TranslationRequest,
  TranslationResult,
  OpenAiSettings,
} from './contracts';
