import type { TakeoverProbeResult } from './contracts';

const latestProbeResult = storage.defineItem<TakeoverProbeResult | null>(
  'local:pdf-probe-latest',
  { fallback: null },
);

export async function saveProbeResult(result: TakeoverProbeResult): Promise<void> {
  await latestProbeResult.setValue(result);
}

export async function getLatestProbeResult(): Promise<TakeoverProbeResult | null> {
  return latestProbeResult.getValue();
}
