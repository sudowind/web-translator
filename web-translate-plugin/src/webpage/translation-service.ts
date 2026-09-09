import { OpenAiTranslationClient } from '../providers/openai/client';
import type { ExtensionSettings } from '../settings/schema';
import type { TranslationResult } from '../providers/openai/contracts';
import { historyEntryId, normalizeHistoryUrl, safeHistoryTitle } from '../history/model';
import type { HistoryEntry } from '../storage/repositories';
import { cacheProfile, cacheScope, digest, type WebpageCache } from './translation-cache';
import { validateInlineResult } from './stream-parser';
import {
  isTranslationBlocksMessage,
  isTranslationCancelMessage,
  isTranslationClearCacheMessage,
  type WebpageProgressEvent,
  type WebpageBackgroundMessage,
} from './messages';

interface MessageSenderLike {
  frameId?: number;
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
  private cacheEpoch = 0;
  private cacheQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly readSettings: SettingsReader,
    private readonly createClient: ClientFactory = (settings) =>
      new OpenAiTranslationClient(settings),
    private readonly recordHistory: HistoryRecorder = async () => undefined,
    private readonly options: { cache?: WebpageCache; emit?: (tabId: number, event: WebpageProgressEvent) => Promise<unknown> } = {},
  ) {}

  async handle(
    message: unknown,
    sender: MessageSenderLike,
  ): Promise<TranslationResult[] | { canceled: true } | { cleared: true }> {
    const tab = sender.tab;
    const tabId = tab?.id;
    if (!tab || tabId === undefined || (sender.frameId !== undefined && sender.frameId !== 0)) {
      throw new Error('网页翻译请求必须来自真实标签页');
    }
    if (isTranslationCancelMessage(message)) {
      this.cancel(tabId, message.sessionId);
      return { canceled: true };
    }
    if (isTranslationClearCacheMessage(message)) {
      this.cacheEpoch++;
      const scope = await cacheScope(tab.url ?? '');
      await this.cacheOperation(() => this.options.cache?.clear(scope));
      return { cleared: true };
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
    const generation = this.cacheEpoch;
    const controller = new AbortController();
    const requests = this.requestsBySession.get(key) ?? new Set<AbortController>();
    requests.add(controller);
    this.requestsBySession.set(key, requests);

    try {
      const settings = await this.readSettings();
      controller.signal.throwIfAborted();
      const scope = await cacheScope(tab.url ?? 'https://unknown.invalid/');
      const profile = await cacheProfile(settings);
      const keys = new Map<string, string>();
      const translations: TranslationResult[] = [];
      const missing: typeof message.blocks = [];
      const aliases = new Map<string, typeof message.blocks>();
      let delivery = Promise.resolve();
      const emit = (event: Omit<WebpageProgressEvent, 'type' | 'sessionId' | 'batchId'>) => {
        delivery = delivery.then(async () => {
          if (!controller.signal.aborted) await this.options.emit?.(tabId, {
            type: 'translation:progress', sessionId: message.sessionId, batchId: message.blocks[0].id, ...event,
          });
        }).catch(() => undefined);
      };
      for (const block of message.blocks) {
        const cacheKey = await digest(JSON.stringify([scope, profile, block.text]));
        keys.set(block.id, cacheKey);
        let cached: string | undefined;
        try { cached = await this.options.cache?.get(cacheKey); if (cached !== undefined) validateInlineResult(block.text, cached); }
        catch { cached = undefined; }
        if (cached !== undefined) { const result = { id: block.id, text: cached }; translations.push(result); emit({ result, cached: true }); }
        else {
          const group = aliases.get(cacheKey);
          if (group) group.push(block);
          else { aliases.set(cacheKey, [block]); missing.push(block); }
        }
      }
      let invalid = false;
      const expand = (result: TranslationResult) => {
        const source = missing.find(block => block.id === result.id);
        if (!source) throw new Error('WEBPAGE_RESPONSE_INVALID');
        validateInlineResult(source.text, result.text);
        return aliases.get(keys.get(result.id)!)!.map(block => ({ id: block.id, text: result.text }));
      };
      try {
      const fresh = missing.length ? await this.createClient(settings.openAi).translate(
        {
          blocks: missing,
          format: 'webpage-inline',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
        controller.signal,
        {
          onBlock: result => { for (const alias of expand(result)) emit({ result: alias }); },
          onInvalidate: () => { invalid = true; emit({ invalid: true }); },
          onTiming: timing => emit({ timing }),
        },
      ) : [];
      if (invalid || fresh.length !== missing.length || new Set(fresh.map(r => r.id)).size !== missing.length) throw new Error('WEBPAGE_RESPONSE_INVALID');
      for (const result of fresh) translations.push(...expand(result));
      controller.signal.throwIfAborted();
      for (const result of fresh) {
        await this.cacheOperation(async () => {
          if (!controller.signal.aborted && generation === this.cacheEpoch) {
            await this.options.cache?.put(keys.get(result.id)!, scope, result.text);
          }
        }).catch(() => undefined);
      }
      } finally { await delivery; }
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

  dispose(tabId: number): void {
    for (const key of this.requestsBySession.keys()) if (key.startsWith(`${tabId}:`)) this.cancel(tabId, key.slice(`${tabId}:`.length));
    for (const key of this.recordedSessions) if (key.startsWith(`${tabId}:`)) this.recordedSessions.delete(key);
  }

  private cacheOperation<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
    const next = this.cacheQueue.then(operation);
    this.cacheQueue = next.catch(() => undefined);
    return next;
  }
}

function sessionKey(tabId: number, sessionId: string): string {
  return `${tabId}:${sessionId}`;
}
