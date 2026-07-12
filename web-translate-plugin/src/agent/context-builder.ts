import type { DocumentModel } from '../document/model';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  requestId?: string;
  status?: 'streaming' | 'done' | 'stopped' | 'failed';
}

export interface AgentContext {
  mode: 'full' | 'compressed';
  text: string;
  notice?: string;
  recentMessages: AgentMessage[];
}

export function buildAgentContext(input: {
  model: DocumentModel;
  activePage: number;
  selection: string;
  recentMessages: AgentMessage[];
  maxCharacters: number;
}): AgentContext {
  const pages = input.model.pages.map((page) =>
    `[p:${page.index + 1}]\n${page.blocks.map((block) => block.text).join('\n')}`);
  const full = pages.join('\n\n');
  if (full.length <= input.maxCharacters) {
    return { mode: 'full', text: full, recentMessages: input.recentMessages };
  }
  const summaries = input.model.pages.map((page) => {
    const heading = page.blocks.find((block) => block.kind === 'heading')?.text;
    const first = page.blocks.find((block) => block.text.trim())?.text ?? '';
    return `[p:${page.index + 1}] ${heading || first.slice(0, 160)}`;
  }).join('\n');
  const active = pages[input.activePage - 1] ?? '';
  return {
    mode: 'compressed',
    text: `${summaries}\n\n当前页全文：\n${active}\n\n用户选中文本：\n${input.selection}`,
    notice: '论文超过上下文字符预算，已使用压缩上下文；包含所有页摘要、当前页全文和选中文本。',
    recentMessages: input.recentMessages,
  };
}
