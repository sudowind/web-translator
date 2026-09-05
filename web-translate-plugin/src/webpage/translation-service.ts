import { OpenAiTranslationClient } from '../providers/openai/client';
import type { ExtensionSettings } from '../settings/schema';
import type { TranslationResult } from '../providers/openai/contracts';
import { historyEntryId, normalizeHistoryUrl, safeHistoryTitle } from '../history/model';
import type { HistoryEntry } from '../storage/repositories';
import {
  isTranslationBlocksMessage,
  isTranslationCancelMessage,
  type WebpageBackgroundMessage,
} from './messages';

interface MessageSenderLike {
  tab?: { id?: number; url?: string; title?: string };
}

type SettingsReader = () => Promise<ExtensionSettings>;
type ClientFactory = (
  settings: ExtensionSettings['openAi'],
) => Pick<OpenAiTranslationClient, 'translate'>;
type HistoryRecorder = (entry: HistoryEntry) => Promise<void>;

export class WebpageTranslationService {
  private readonly requestsBySession = new Map<string, Set<AbortController>>();
  private readonly recordedSessions = new Set<string>();

  constructor(
    private readonly readSettings: SettingsReader,
    private readonly createClient: ClientFactory = (settings) =>
      new OpenAiTranslationClient(settings),
    private readonly recordHistory: HistoryRecorder = async () => undefined,
  ) {}

  async handle(
    message: unknown,
    sender: MessageSenderLike,
  ): Promise<TranslationResult[] | { canceled: true }> {
    const tab = sender.tab;
    const tabId = tab?.id;
    if (!tab || tabId === undefined) {
      throw new Error('网页翻译请求必须来自真实标签页');
    }
    if (isTranslationCancelMessage(message)) {
      this.cancel(tabId, message.sessionId);
      return { canceled: true };
    }
    if (!isTranslationBlocksMessage(message)) {
      throw new Error('网页翻译消息格式无效');
    }
    return this.translate(tabId, message, tab);
  }

  private async translate(
    tabId: number,
    message: Extract<WebpageBackgroundMessage, { type: 'translation:blocks' }>,
    tab: NonNullable<MessageSenderLike['tab']>,
  ): Promise<TranslationResult[]> {
    const key = sessionKey(tabId, message.sessionId);
    const controller = new AbortController();
    const requests = this.requestsBySession.get(key) ?? new Set<AbortController>();
    requests.add(controller);
    this.requestsBySession.set(key, requests);

    try {
      const settings = await this.readSettings();
      const translations = await this.createClient(settings.openAi).translate(
        {
          blocks: message.blocks,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
        controller.signal,
      );
      if (!this.recordedSessions.has(key) && tab.url) {
        this.recordedSessions.add(key);
        try {
          const url = normalizeHistoryUrl(tab.url);
          await this.recordHistory({
            id: historyEntryId('webpage', url), kind: 'webpage', url,
            title: safeHistoryTitle(tab.title ?? '', url),
            sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage,
            lastVisitedAt: Date.now(),
          });
        } catch {
          // 历史记录是辅助能力，不得让存储或 URL 异常中断网页翻译。
        }
      }
      return translations;
    } finally {
      requests.delete(controller);
      if (requests.size === 0) this.requestsBySession.delete(key);
    }
  }

  private cancel(tabId: number, sessionId: string): void {
    const key = sessionKey(tabId, sessionId);
    this.recordedSessions.delete(key);
    const requests = this.requestsBySession.get(key);
    if (!requests) return;
    for (const controller of requests) controller.abort();
    this.requestsBySession.delete(key);
  }
}

function sessionKey(tabId: number, sessionId: string): string {
  return `${tabId}:${sessionId}`;
}
