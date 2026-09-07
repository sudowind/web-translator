import { renderInlineTranslation, scanSemanticBlocks, type SemanticBlock } from './semantic-blocks';

export interface BilingualRecord {
  id: string;
  block: SemanticBlock;
  node?: HTMLElement;
  state: 'pending' | 'loading' | 'done' | 'failed';
  output?: string;
}

export class BilingualController {
  private records = new Map<Node, BilingualRecord>();
  private sequence = 0;

  constructor(private root: HTMLElement, private readonly onRetry: () => void) {}

  reconcile(root = this.root): void {
    this.root = root;
    const next = new Map<Node, BilingualRecord>();
    for (const block of scanSemanticBlocks(this.root)) {
      let record = this.records.get(block.key);
      if (record && (record.block.signature !== block.signature ||
        record.block.nodes.length !== block.nodes.length ||
        record.block.nodes.some((node, index) => node !== block.nodes[index]))) {
        record.node?.remove();
        record = undefined;
      }
      if (!record) record = { id: `web-block-${++this.sequence}`, block, state: 'pending' };
      const presentationChanged = record.block.style !== block.style ||
        JSON.stringify(record.block.slots) !== JSON.stringify(block.slots);
      record.block = block;
      next.set(block.key, record);
      if (record.node) {
        if (presentationChanged) {
          record.node.style.cssText = this.hostStyle(block);
          if (record.output !== undefined) record.node.replaceChildren(renderInlineTranslation(block, record.output));
        }
        this.place(record);
      }
    }
    for (const [key, record] of this.records) if (!next.has(key)) record.node?.remove();
    this.records = next;
  }

  status() {
    const values = [...this.records.values()];
    return { count: values.length, translated: values.filter((record) => record.state === 'done').length,
      failed: values.filter((record) => record.state === 'failed').length };
  }

  takeBatch(): BilingualRecord[] {
    const view = this.root.ownerDocument.defaultView!;
    const visible = (record: BilingualRecord) => {
      const rect = record.block.container.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= view.innerHeight;
    };
    const pending = [...this.records.values()].filter((record) => record.state === 'pending')
      .sort((a, b) => Number(visible(b)) - Number(visible(a)));
    const batch: BilingualRecord[] = [];
    let length = 0;
    for (const record of pending) {
      if (record.block.text.length > 10_000) { this.fail(record, '此段过长，暂无法整块翻译'); continue; }
      if (batch.length >= 20 || (batch.length > 0 && length + record.block.text.length > 12_000)) break;
      length += record.block.text.length;
      record.state = 'loading';
      batch.push(record);
    }
    return batch;
  }

  apply(record: BilingualRecord, text: string): void {
    if (!this.current(record)) return;
    try {
      const content = renderInlineTranslation(record.block, text);
      const node = this.host(record);
      node.replaceChildren(content);
      node.dataset.webTranslateState = 'done';
      record.state = 'done';
      record.output = text;
      this.place(record);
    } catch { this.fail(record, '译文格式不完整，请重试'); }
  }

  fail(record: BilingualRecord, message = '此段翻译失败，请重试'): void {
    if (!this.current(record)) return;
    record.state = 'failed';
    const node = this.host(record);
    node.dataset.webTranslateState = 'failed';
    const button = node.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = message;
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (!this.current(record)) return;
      record.state = 'pending';
      node.remove(); record.node = undefined;
      this.onRetry();
    });
    node.replaceChildren(button);
    this.place(record);
  }

  clear(): void {
    for (const record of this.records.values()) record.node?.remove();
    this.records.clear();
  }

  private current(record: BilingualRecord): boolean {
    return this.records.get(record.block.key) === record && record.block.container.isConnected;
  }

  private host(record: BilingualRecord): HTMLElement {
    if (!record.node) {
      const node = this.root.ownerDocument.createElement('span');
      node.dataset.webTranslateUi = '';
      node.dataset.webTranslateBlock = record.id;
      node.style.cssText = this.hostStyle(record.block);
      record.node = node;
    }
    return record.node;
  }

  private hostStyle(block: SemanticBlock): string {
    return `${block.style}display:block;margin-block:0.35em 0;`;
  }

  private place(record: BilingualRecord): void {
    const anchor = record.block.nodes.at(-1)!;
    if (record.node && anchor.parentNode && anchor.nextSibling !== record.node) {
      anchor.parentNode.insertBefore(record.node, anchor.nextSibling);
    }
  }
}
