export async function readPdfBytes(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(url, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return false;

  const bytes = new Uint8Array(await response.arrayBuffer());
  return (
    bytes.length >= 5 &&
    new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
  );
}
