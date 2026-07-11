import type { DocumentPage } from '../document/model';
import type {
  TranslationRequest,
  TranslationResult,
} from '../providers/openai/contracts';

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

  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
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
): Promise<TranslationResult[]> {
  const blocks = page.blocks
    .filter((block) => translatableKinds.has(block.kind))
    .map(({ id, text }) => ({ id, text }));
  if (blocks.length === 0) return [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await client.translate({ ...languages, blocks }, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const status = readStatus(error);
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt === 2) {
        throw new PageTranslationError(
          status === undefined ? 'TRANSLATION_FAILED' : `TRANSLATION_HTTP_${status}`,
          retryable,
        );
      }
      await sleepWithSignal(sleep, 1_000 * 2 ** attempt, signal);
    }
  }
  throw new PageTranslationError('TRANSLATION_FAILED', false);
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

function readStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  const message = error instanceof Error ? error.message : '';
  const match = /\((\d{3})\)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
