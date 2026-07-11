import { OpenAiTranslationClient } from '../providers/openai/client';
import type { ExtensionSettings } from '../settings/schema';
import type { TranslationResult } from '../providers/openai/contracts';
import {
  isTranslationBlocksMessage,
  isTranslationCancelMessage,
  type WebpageBackgroundMessage,
} from './messages';

interface MessageSenderLike {
  tab?: { id?: number };
}

type SettingsReader = () => Promise<ExtensionSettings>;
type ClientFactory = (
  settings: ExtensionSettings['openAi'],
) => Pick<OpenAiTranslationClient, 'translate'>;

export class WebpageTranslationService {
  private readonly requestsBySession = new Map<string, Set<AbortController>>();

  constructor(
    private readonly readSettings: SettingsReader,
    private readonly createClient: ClientFactory = (settings) =>
      new OpenAiTranslationClient(settings),
  ) {}

  async handle(
    message: unknown,
    sender: MessageSenderLike,
  ): Promise<TranslationResult[] | { canceled: true }> {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      throw new Error('网页翻译请求必须来自真实标签页');
    }
    if (isTranslationCancelMessage(message)) {
      this.cancel(tabId, message.sessionId);
      return { canceled: true };
    }
    if (!isTranslationBlocksMessage(message)) {
      throw new Error('网页翻译消息格式无效');
    }
    return this.translate(tabId, message);
  }

  private async translate(
    tabId: number,
    message: Extract<WebpageBackgroundMessage, { type: 'translation:blocks' }>,
  ): Promise<TranslationResult[]> {
    const key = sessionKey(tabId, message.sessionId);
    const controller = new AbortController();
    const requests = this.requestsBySession.get(key) ?? new Set<AbortController>();
    requests.add(controller);
    this.requestsBySession.set(key, requests);

    try {
      const settings = await this.readSettings();
      return await this.createClient(settings.openAi).translate(
        {
          blocks: message.blocks,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
        controller.signal,
      );
    } finally {
      requests.delete(controller);
      if (requests.size === 0) this.requestsBySession.delete(key);
    }
  }

  private cancel(tabId: number, sessionId: string): void {
    const key = sessionKey(tabId, sessionId);
    const requests = this.requestsBySession.get(key);
    if (!requests) return;
    for (const controller of requests) controller.abort();
    this.requestsBySession.delete(key);
  }
}

function sessionKey(tabId: number, sessionId: string): string {
  return `${tabId}:${sessionId}`;
}
