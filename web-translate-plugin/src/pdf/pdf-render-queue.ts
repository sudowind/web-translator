export type PdfRenderPriority = 'visible-final' | 'near-preview' | 'idle-preview';

type Release = () => void;

interface WaitingTask {
  priority: number;
  sequence: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve(release: Release): void;
  reject(error: Error): void;
}

const PRIORITY: Record<PdfRenderPriority, number> = {
  'visible-final': 0,
  'near-preview': 1,
  'idle-preview': 2,
};

function abortError(): Error {
  const error = new Error('PDF render queue request aborted');
  error.name = 'AbortError';
  return error;
}

export class PdfRenderQueue {
  private active = 0;
  private sequence = 0;
  private readonly waiting: WaitingTask[] = [];

  constructor(private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('PDF render concurrency must be a positive integer');
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  acquire(priority: PdfRenderPriority, signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<Release>((resolve, reject) => {
      const task: WaitingTask = {
        priority: PRIORITY[priority],
        sequence: this.sequence++,
        signal,
        resolve,
        reject,
      };
      task.onAbort = () => {
        const index = this.waiting.indexOf(task);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener('abort', task.onAbort, { once: true });
      this.waiting.push(task);
      this.drain();
    });
  }

  private drain(): void {
    this.waiting.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      task.signal?.removeEventListener('abort', task.onAbort!);
      if (task.signal?.aborted) {
        task.reject(abortError());
        continue;
      }
      this.active += 1;
      let released = false;
      task.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.drain();
      });
    }
  }
}

export const sharedPdfRenderQueue = new PdfRenderQueue(2);
