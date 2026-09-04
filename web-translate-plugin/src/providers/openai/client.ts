import { LlmProviderError, OpenAiChatClient } from './chat-client';
import { TRANSLATION_OUTPUT_INSTRUCTIONS } from './translation-format';
import { resolveTranslationOutputFormat } from '../../settings/translation-capabilities';
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
      const outputMode = await resolveTranslationOutputFormat(this.settings);
      signal?.throwIfAborted();
      content = await new OpenAiChatClient({ ...this.settings,
        translation: { ...this.settings.translation, outputMode },
      }, this.fetcher).complete(
        {
          purpose: 'translation',
          messages: [
            {
              role: 'system',
              content:
                `Translate each block from ${request.sourceLanguage} to ${request.targetLanguage}. ` +
                TRANSLATION_OUTPUT_INSTRUCTIONS +
                'Preserve Markdown structure, inline/display math delimiters and code fences. ' +
                'Do not translate math expressions. For table and figure blocks, the input text is caption only. ' +
                'Translate it as plain Markdown; never output a table body or image content.',
            },
            { role: 'user', content: JSON.stringify({ blocks: request.blocks }) },
          ],
        },
        signal,
      );
    } catch (error) {
      if (error instanceof LlmProviderError) {
        if (error.code === 'LLM_OUTPUT_FORMAT_UNSUPPORTED') {
          throw new TranslationProviderError('TRANSLATION_OUTPUT_FORMAT_UNSUPPORTED');
        }
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
