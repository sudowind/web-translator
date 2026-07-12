import type { AgentMessage } from './context-builder';

export function appendAgentDelta(
  messages: AgentMessage[],
  requestId: string,
  delta: string,
): AgentMessage[] {
  return updateMatching(messages, requestId, (message) => ({
    ...message,
    content: message.content + delta,
  }));
}

export function finalizeAgentAnswer(
  messages: AgentMessage[],
  requestId: string,
  answer: string,
): AgentMessage[] {
  return updateMatching(messages, requestId, (message) => ({
    ...message,
    content: answer,
    status: 'done',
  }));
}

export function stopAgentAnswer(messages: AgentMessage[], requestId: string): AgentMessage[] {
  return updateMatching(messages, requestId, (message) => ({
    ...message,
    status: 'stopped',
  }));
}

export function failAgentAnswer(messages: AgentMessage[], requestId: string): AgentMessage[] {
  return updateMatching(messages, requestId, (message) => ({
    ...message,
    status: 'failed',
  }));
}

function updateMatching(
  messages: AgentMessage[],
  requestId: string,
  update: (message: AgentMessage) => AgentMessage,
): AgentMessage[] {
  const index = messages.findLastIndex((message) =>
    message.role === 'assistant' && message.requestId === requestId);
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = update(messages[index]);
  return next;
}
