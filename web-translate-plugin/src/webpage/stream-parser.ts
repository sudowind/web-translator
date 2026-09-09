import type { TranslationBlockInput, TranslationResult } from '../providers/openai/contracts';

function topology(text: string): string {
  const stack: string[] = [];
  const slots = new Map<string, string>();
  let end = 0;
  for (const m of text.matchAll(/⟦(\/?)wt:(\d+)(\/?)⟧/g)) {
    if (/⟦\/?wt:/.test(text.slice(end, m.index))) throw new Error('WEBPAGE_INLINE_INVALID');
    end = m.index! + m[0].length;
    if (m[1]) {
      if (m[3] || stack.pop() !== m[2]) throw new Error('WEBPAGE_INLINE_INVALID');
    } else {
      if (slots.has(m[2])) throw new Error('WEBPAGE_INLINE_INVALID');
      slots.set(m[2], `${stack.at(-1) ?? ''}:${m[3]}`);
      if (!m[3]) stack.push(m[2]);
    }
  }
  if (stack.length || /⟦\/?wt:/.test(text.slice(end))) throw new Error('WEBPAGE_INLINE_INVALID');
  return JSON.stringify([...slots].sort(([a], [b]) => a.localeCompare(b)));
}

export function validateInlineResult(source: string, text: string): void {
  if (!text.trim() || text.length > 100_000 || topology(source) !== topology(text)) throw new Error('WEBPAGE_INLINE_INVALID');
}

// Only complete top-level array objects are exposed; braces inside JSON strings are ignored.
export class WebpageStreamParser {
  private text = '';
  private cursor = 0;
  private start = -1;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private opened = false;
  private readonly seen = new Map<string, string>();
  invalid = false;
  constructor(private readonly blocks: TranslationBlockInput[], private readonly emit: (result: TranslationResult) => void) {}
  push(delta: string): void {
    if (this.invalid) return;
    this.text += delta;
    if (this.text.length > 2_000_000) { this.invalid = true; return; }
    if (!this.opened) {
      const prefix = /^\s*\{\s*"(?:translations|blocks)"\s*:\s*\[/.exec(this.text);
      if (!prefix) return;
      this.cursor = prefix[0].length;
      this.opened = true;
    }
    for (; this.cursor < this.text.length; this.cursor++) {
      const c = this.text[this.cursor];
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.quoted = false;
        continue;
      }
      if (c === '"') this.quoted = true;
      else if (c === '{') { if (this.depth++ === 0) this.start = this.cursor; }
      else if (c === '}' && this.depth > 0 && --this.depth === 0) {
        try {
          const result = JSON.parse(this.text.slice(this.start, this.cursor + 1));
          const source = this.blocks.find(block => block.id === result.id);
          if (!source || typeof result.text !== 'string' || this.seen.has(result.id)) throw new Error('invalid');
          validateInlineResult(source.text, result.text);
          this.seen.set(result.id, result.text);
          this.emit({ id: result.id, text: result.text });
        } catch { this.invalid = true; return; }
      } else if (c === ']' && this.depth === 0) { this.cursor = this.text.length; return; }
    }
  }
  finish(results: TranslationResult[]): void {
    if (this.invalid) throw new Error('WEBPAGE_RESPONSE_INVALID');
    for (const result of results) {
      const source = this.blocks.find(block => block.id === result.id);
      if (!source || (this.seen.has(result.id) && this.seen.get(result.id) !== result.text)) throw new Error('WEBPAGE_RESPONSE_INVALID');
      validateInlineResult(source.text, result.text);
    }
  }
}
