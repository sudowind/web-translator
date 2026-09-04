import { historyUrlWithPage } from '../history/model';
import type { HistoryEntry, StorageSummary } from '../storage/repositories';

export type DashboardMessage =
  | { type: 'dashboard:get-state' }
  | { type: 'dashboard:delete-history'; id: string }
  | { type: 'dashboard:clear-history' }
  | { type: 'dashboard:clear-cache' }
  | { type: 'dashboard:open-history'; id: string };

export interface DashboardState { entries: HistoryEntry[]; summary: StorageSummary }
export type DashboardResponse =
  | { ok: true; value: DashboardState | { opened: true } }
  | { ok: false; error: string };

interface DashboardSender { id?: string; url?: string }
export interface DashboardDependencies {
  listHistory(): Promise<HistoryEntry[]>;
  getHistory(id: string): Promise<HistoryEntry | undefined>;
  deleteHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  clearCache(): Promise<void>;
  getSummary(): Promise<StorageSummary>;
  openUrl(url: string): Promise<void>;
}

export function isDashboardCandidate(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value &&
    typeof value.type === 'string' && value.type.startsWith('dashboard:');
}

export function isDashboardMessage(value: unknown): value is DashboardMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'dashboard:get-state' || value.type === 'dashboard:clear-history' || value.type === 'dashboard:clear-cache') {
    return hasExactKeys(value, ['type']);
  }
  if (value.type === 'dashboard:delete-history' || value.type === 'dashboard:open-history') {
    return hasExactKeys(value, ['type', 'id']) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 2_300;
  }
  return false;
}

export function isOptionsPageSender(sender: DashboardSender, optionsUrl: string): boolean {
  if (!sender.id || !sender.url) return false;
  try {
    const expected = new URL(optionsUrl);
    const actual = new URL(sender.url);
    return sender.id === expected.hostname && actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export async function dispatchDashboardMessage(
  candidate: unknown,
  sender: DashboardSender,
  optionsUrl: string,
  dependencies: DashboardDependencies,
): Promise<DashboardResponse> {
  if (!isOptionsPageSender(sender, optionsUrl)) return { ok: false, error: 'DASHBOARD_SENDER_INVALID' };
  if (!isDashboardMessage(candidate)) return { ok: false, error: 'DASHBOARD_MESSAGE_INVALID' };
  try {
    if (candidate.type === 'dashboard:open-history') {
      const entry = await dependencies.getHistory(candidate.id);
      if (!entry) return { ok: false, error: 'HISTORY_ENTRY_NOT_FOUND' };
      await dependencies.openUrl(historyUrlWithPage(entry));
      return { ok: true, value: { opened: true } };
    }
    if (candidate.type === 'dashboard:delete-history') await dependencies.deleteHistory(candidate.id);
    else if (candidate.type === 'dashboard:clear-history') await dependencies.clearHistory();
    else if (candidate.type === 'dashboard:clear-cache') await dependencies.clearCache();
    const [entries, summary] = await Promise.all([dependencies.listHistory(), dependencies.getSummary()]);
    return { ok: true, value: { entries, summary } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'DASHBOARD_OPERATION_FAILED' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys<K extends string>(value: Record<string, unknown>, keys: readonly K[]): value is Record<K, unknown> {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
