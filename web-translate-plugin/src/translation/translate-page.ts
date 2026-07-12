import type { DocumentPage } from '../document/model';
import type {
  TranslationRequest,
  TranslationResult,
} from '../providers/openai/contracts';
import { classifyTranslationFailure, type TranslationFailure } from './failure';

interface PageTranslationClient {
  translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult[]>;
}

interface TranslationLanguages {
  sourceLanguage: string;
  targetLanguage: string;
}

export class PageTranslationError extends Error {
  readonly name = 'PageTranslationError';

  constructor(readonly failure: TranslationFailure) {
    super(failure.code);
  }

  get code(): string { return this.failure.code; }
  get retryable(): boolean { return this.failure.retryable; }
}

const translatableKinds = new Set([
  'heading',
  'paragraph',
  'list',
  'caption',
  'footnote',
  'other',
]);

export async function translatePage(
  client: PageTranslationClient,
  page: DocumentPage,
  languages: TranslationLanguages,
  signal?: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  model = 'unknown',
): Promise<TranslationResult[]> {
  const blocks = page.blocks
    .filter((block) => translatableKinds.has(block.kind))
    .map(({ id, text }) => ({ id, text }));
  if (blocks.length === 0) return [];

  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await client.translate({ ...languages, blocks }, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const failure = classifyTranslationFailure(error, {
        attempts: attempt + 1,
        durationMs: Date.now() - startedAt,
        model,
      });
      const autoRetry = failure.category === 'rate-limit' || failure.category === 'server' || failure.category === 'network';
      if (!autoRetry || attempt === 2) {
        throw new PageTranslationError(failure);
      }
      await sleepWithSignal(sleep, 1_000 * 2 ** attempt, signal);
    }
  }
  throw new PageTranslationError(classifyTranslationFailure(undefined, {
    attempts: 3,
    durationMs: Date.now() - startedAt,
    model,
  }));
}

async function sleepWithSignal(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleep(ms);
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
