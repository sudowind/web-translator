import { LlmProviderError, OpenAiChatClient } from './chat-client';
import type {
  OpenAiSettings,
  TranslationRequest,
  TranslationResult,
} from './contracts';

export class TranslationProviderError extends Error {
  readonly name = 'TranslationProviderError';

  constructor(readonly code: string) {
    super(code);
  }
}

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
                'Return one JSON object with a translations array. Preserve every id exactly once.',
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('翻译响应不是有效 JSON');
    }

    const translations = this.readTranslations(parsed);
    const expectedIds = new Set(request.blocks.map(({ id }) => id));
    const resultById = new Map<string, TranslationResult>();
    for (const translation of translations) {
      if (!expectedIds.has(translation.id)) {
        throw new Error(`翻译响应包含未知 id: ${translation.id}`);
      }
      if (resultById.has(translation.id)) {
        throw new Error(`翻译响应包含重复 id: ${translation.id}`);
      }
      resultById.set(translation.id, translation);
    }
    if (resultById.size !== expectedIds.size) throw new Error('翻译响应缺少 id');

    return request.blocks.map(({ id }) => resultById.get(id)!);
  }

  private readTranslations(value: unknown): TranslationResult[] {
    if (typeof value !== 'object' || value === null) throw new Error('翻译响应格式无效');
    const translations = (value as { translations?: unknown }).translations;
    if (!Array.isArray(translations)) throw new Error('翻译响应格式无效');
    if (
      !translations.every(
        (item): item is TranslationResult =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as TranslationResult).id === 'string' &&
          typeof (item as TranslationResult).text === 'string',
      )
    ) {
      throw new Error('翻译响应格式无效');
    }
    return translations;
  }
}

export type {
  TranslationBlockInput,
  TranslationRequest,
  TranslationResult,
  OpenAiSettings,
} from './contracts';
