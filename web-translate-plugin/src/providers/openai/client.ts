import type {
  TranslationRequest,
  TranslationResult,
  TranslationSettings,
} from './contracts';

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class OpenAiTranslationClient {
  constructor(
    private readonly settings: TranslationSettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult[]> {
    const { apiKey, baseUrl, model } = this.settings;
    if (!apiKey.trim() || !baseUrl.trim() || !model.trim()) {
      throw new Error('翻译 Provider 配置不完整');
    }

    const { sourceLanguage, targetLanguage } = request;
    const response = await this.fetcher(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                `Translate each block from ${sourceLanguage} to ${targetLanguage}. ` +
                'Return one JSON object with a translations array. Preserve every id exactly once.',
            },
            {
              role: 'user',
              content: JSON.stringify({ blocks: request.blocks }),
            },
          ],
        }),
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(`翻译请求失败 (${response.status})`);
    }

    const payload = (await response.json()) as ChatCompletionsResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('翻译响应格式无效');
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
    if (resultById.size !== expectedIds.size) {
      throw new Error('翻译响应缺少 id');
    }

    return request.blocks.map(({ id }) => resultById.get(id)!);
  }

  private readTranslations(value: unknown): TranslationResult[] {
    if (typeof value !== 'object' || value === null) {
      throw new Error('翻译响应格式无效');
    }
    const translations = (value as { translations?: unknown }).translations;
    if (!Array.isArray(translations)) {
      throw new Error('翻译响应格式无效');
    }
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
  TranslationSettings,
} from './contracts';
