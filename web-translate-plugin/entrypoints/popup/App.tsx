import { useEffect, useState } from 'react';

import type { TakeoverProbeResult } from '../../src/pdf-takeover/contracts';
import type {
  PdfProbeMessage,
  PdfProbeResponse,
} from '../../src/pdf-takeover/messages';
import {
  sendPdfWorkspaceCommand,
  type PdfWorkspacePopupStatus,
} from '../../src/pdf/popup-client';
import {
  sendWebpageCommand,
  webpagePopupErrorText,
} from '../../src/webpage/popup-client';

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
  const [webpageEnabled, setWebpageEnabled] = useState(false);
  const [webpageBusy, setWebpageBusy] = useState(false);
  const [webpageFeedback, setWebpageFeedback] = useState(
    '普通网页翻译默认关闭',
  );
  const [pdfStatus, setPdfStatus] = useState<PdfWorkspacePopupStatus | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState('正在识别当前页面');

  useEffect(() => {
    void sendProbeMessage({ type: 'pdf-probe:latest' })
      .then((latest) => {
        if (latest !== null) setOutput(JSON.stringify(latest, null, 2));
      })
      .catch((error: unknown) => {
        setOutput(`读取最近报告失败：${errorText(error)}`);
      });
  }, []);

  useEffect(() => {
    void sendPdfWorkspaceCommand('status').then((status) => {
      setPdfStatus(status);
      setPdfFeedback(status.enabled ? 'PDF 工作台已启用' : status.eligible ? '可翻译此 PDF' : '当前页面不是支持的 PDF');
    }, (error: unknown) => setPdfFeedback(`PDF 状态读取失败：${errorText(error)}`));
  }, []);

  useEffect(() => {
    void sendWebpageCommand('webpage:status')
      .then((status) => {
        setWebpageEnabled(status.enabled);
        if (status.enabled) setWebpageFeedback(`已翻译 ${status.count} 个文本块`);
      })
      .catch(() => undefined);
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

  async function toggleWebpage() {
    setWebpageBusy(true);
    try {
      const status = await sendWebpageCommand(
        webpageEnabled ? 'webpage:disable' : 'webpage:enable',
      );
      setWebpageEnabled(status.enabled);
      setWebpageFeedback(
        status.reason === 'PAGE_NOT_ELIGIBLE'
          ? '此页面包含敏感内容、属于 PDF 或不支持注入，无法启用'
          : status.enabled
            ? `已翻译 ${status.count} 个文本块；悬停译文可查看原文`
            : '已关闭并恢复页面原文',
      );
    } catch (error) {
      setWebpageFeedback(webpagePopupErrorText(error));
    } finally {
      setWebpageBusy(false);
    }
  }

  async function togglePdfWorkspace() {
    if (!pdfStatus) return;
    setPdfBusy(true);
    try {
      const next = await sendPdfWorkspaceCommand(pdfStatus.enabled ? 'disable' : 'enable');
      setPdfStatus(next);
      setPdfFeedback(next.enabled ? 'PDF 工作台已启用；关闭后恢复原页面' : 'PDF 工作台已关闭并恢复原页面');
    } catch (error) {
      setPdfFeedback(`操作失败：${errorText(error)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main>
      <section aria-labelledby="webpage-heading">
        <p className="eyebrow">页面工具</p>
        {pdfStatus?.eligible ? <>
          <h2 id="webpage-heading">PDF 翻译工作台</h2>
          <p className="description">PDF.js 左栏独立阅读，解析完成后从第 1 页按顺序生成译文。</p>
          <button className="primary" type="button" disabled={pdfBusy} onClick={() => void togglePdfWorkspace()}>
            {pdfBusy ? '处理中…' : pdfStatus.enabled ? '关闭 PDF 工作台' : '翻译此 PDF'}
          </button>
          <p className="status" aria-live="polite">{pdfFeedback}</p>
        </> : <>
          <h2 id="webpage-heading">普通网页翻译</h2>
          <p className="description">由你主动启用；关闭后恢复本页全部原文。</p>
          <button
            className="primary"
            type="button"
            disabled={webpageBusy}
            onClick={() => void toggleWebpage()}
          >
            {webpageBusy ? '处理中…' : webpageEnabled ? '关闭并恢复原文' : '翻译当前网页'}
          </button>
          <p className="status" aria-live="polite">{pdfStatus === null ? pdfFeedback : webpageFeedback}</p>
        </>}
        <button className="text-button" type="button" onClick={() => void browser.runtime.openOptionsPage()}>
          打开阅读控制台
        </button>
      </section>

      <section className="probe" aria-label="PDF 接管探针">
        <h1>PDF 接管探针</h1>
        <button type="button" disabled={running} onClick={() => void runProbe()}>
          {running ? '运行中…' : '运行探针'}
        </button>
        {output === null ? <p>尚未运行</p> : <pre>{output}</pre>}
      </section>
    </main>
  );
}
