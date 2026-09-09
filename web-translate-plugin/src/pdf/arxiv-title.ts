import { resolveArxivSource } from './arxiv-source';

export async function readArxivTitle(sourceUrl: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  const identity = resolveArxivSource(sourceUrl);
  if (!identity) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetcher(`https://arxiv.org/abs/${identity.id}`, {
      credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = ''; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 256_000) return;
        html += decoder.decode(chunk.value, { stream: true });
        if (/<\/head\s*>/i.test(html)) break;
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const values = new Map<string, string>();
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = new Map([...tag[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
      if (attrs.has('name') && attrs.has('content')) values.set(attrs.get('name')!.toLowerCase(), attrs.get('content')!);
    }
    const id = values.get('citation_arxiv_id');
    if (!id || id.replace(/v\d+$/i, '') !== identity.id.replace(/v\d+$/i, '')) return;
    const title = decodeEntities(values.get('citation_title') ?? '').replace(/\s+/g, ' ').trim();
    return title.length >= 4 && title.length <= 300 ? title : undefined;
  } catch { return; }
  finally { clearTimeout(timer); }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  });
}
