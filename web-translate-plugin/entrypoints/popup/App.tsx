import { useEffect, useState } from 'react';

import type { TakeoverProbeResult } from '../../src/pdf-takeover/contracts';
import type {
  PdfProbeMessage,
  PdfProbeResponse,
} from '../../src/pdf-takeover/messages';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendProbeMessage(message: PdfProbeMessage) {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as PdfProbeResponse;
  if (!response) throw new Error('后台未返回有效响应');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

export default function App() {
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void sendProbeMessage({ type: 'pdf-probe:latest' })
      .then((latest) => {
        if (latest !== null) setOutput(JSON.stringify(latest, null, 2));
      })
      .catch((error: unknown) => {
        setOutput(`读取最近报告失败：${errorText(error)}`);
      });
  }, []);

  async function runProbe() {
    setRunning(true);
    try {
      const result = (await sendProbeMessage({
        type: 'pdf-probe:run',
      })) as TakeoverProbeResult;
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      setOutput(`运行探针失败：${errorText(error)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main>
      <h1>PDF 接管探针</h1>
      <button type="button" disabled={running} onClick={() => void runProbe()}>
        {running ? '运行中…' : '运行探针'}
      </button>
      {output === null ? <p>尚未运行</p> : <pre>{output}</pre>}
    </main>
  );
}
