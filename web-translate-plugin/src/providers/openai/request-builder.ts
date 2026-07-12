import {
  resolveAgentProfile,
  type ModelProfile,
  type OpenAiSettings,
  type ProviderDialect,
  type ReasoningSettings,
} from '../../settings/schema';

export type LlmPurpose = 'connection-test' | 'translation' | 'agent';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BuildChatRequestInput {
  purpose: LlmPurpose;
  settings: OpenAiSettings;
  messages: ChatMessage[];
}

export interface BuiltChatRequest {
  body: Record<string, unknown>;
  timeoutMs: number;
}

export function buildChatRequest(input: BuildChatRequestInput): BuiltChatRequest {
  const { purpose, settings, messages } = input;
  const selected = selectProfile(purpose, settings);
  const reasoning = purpose === 'agent' ? selected.reasoning : { mode: 'off' as const };
  const body: Record<string, unknown> = {
    model: selected.model,
    messages,
  };

  if (purpose === 'connection-test') body.max_tokens = 16;
  if (purpose === 'translation') body.response_format = { type: 'json_object' };
  applyReasoning(body, settings.dialect, reasoning);

  return {
    body,
    timeoutMs: purpose === 'connection-test' ? 15_000 : selected.timeoutMs,
  };
}

function selectProfile(purpose: LlmPurpose, settings: OpenAiSettings): ModelProfile {
  return purpose === 'agent' ? resolveAgentProfile(settings) : settings.translation;
}

function applyReasoning(
  body: Record<string, unknown>,
  dialect: ProviderDialect,
  reasoning: ReasoningSettings,
): void {
  if (dialect === 'dashscope') {
    if (reasoning.mode === 'auto') return;
    body.enable_thinking = reasoning.mode === 'on';
    if (reasoning.mode === 'on' && reasoning.budgetTokens !== undefined) {
      body.thinking_budget = reasoning.budgetTokens;
    }
    return;
  }

  if (dialect === 'openai') {
    if (reasoning.mode === 'on') body.reasoning_effort = reasoning.effort ?? 'medium';
    return;
  }

  if (dialect === 'minimax') {
    if (reasoning.mode === 'on') throw new Error('MiniMax 仅支持关闭或自动思考');
    body.thinking = { type: reasoning.mode === 'off' ? 'disabled' : 'adaptive' };
    return;
  }

  if (reasoning.mode === 'on') {
    throw new Error('通用 OpenAI 兼容接口不支持显式开启思考');
  }
}
