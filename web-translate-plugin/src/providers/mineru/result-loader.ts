import { strFromU8, unzipSync } from 'fflate';

import { normalizeMineru } from '../../document/normalize-mineru';
import type { DocumentMetadata, DocumentModel } from '../../document/model';
import { MineruError } from './contracts';
import { validateMineruResultUrl } from './result-origin';

export async function loadMineruResult(
  zipUrl: string,
  metadata: DocumentMetadata,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DocumentModel> {
  const validatedZipUrl = validateMineruResultUrl(zipUrl);
  let response: Response;
  try {
    const request = fetcher;
    response = await request(validatedZipUrl);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new MineruError('MINERU_RESULT_NETWORK');
  }
  if (!response.ok) throw new MineruError('MINERU_RESULT_HTTP', response.status);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await response.arrayBuffer()), {
      filter: (file) => isMineruContentListEntry(file.name),
    });
  } catch {
    throw new MineruError('MINERU_ZIP_INVALID');
  }
  const entries = Object.entries(files).filter(([name]) =>
    name.endsWith('_content_list.json'),
  );
  if (entries.length === 0) throw new MineruError('MINERU_CONTENT_LIST_MISSING');
  if (entries.length > 1) throw new MineruError('MINERU_CONTENT_LIST_DUPLICATE');

  let blocks: unknown;
  try {
    blocks = JSON.parse(strFromU8(entries[0][1]));
  } catch {
    throw new MineruError('MINERU_CONTENT_LIST_INVALID');
  }
  if (!Array.isArray(blocks)) throw new MineruError('MINERU_CONTENT_LIST_INVALID');
  return normalizeMineru(blocks, metadata);
}

export function isMineruContentListEntry(name: string): boolean {
  return name.endsWith('_content_list.json');
}
