import { useEffect, useState } from 'react';
import { webpageProgressText } from '../../src/webpage/progress-view';
import { BrandLogo } from '../../src/brand/BrandLogo';

import type { TakeoverProbeResult } from '../../src/pdf-takeover/contracts';
import type {
  PdfProbeMessage,
  PdfProbeResponse,
} from '../../src/pdf-takeover/messages';
import {
  sendPdfWorkspaceCommand,
  requestPdfResumePermission,
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
    '译文将显示在原文下方',
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
      setPdfFeedback(status.enabled ? '对照阅读已开启' : status.eligible ? '已识别 PDF · 可以开始翻译' : '');
    }, (error: unknown) => setPdfFeedback(`PDF 状态读取失败：${errorText(error)}`));
  }, []);

  useEffect(() => {
    void sendWebpageCommand('webpage:status')
      .then((status) => {
        setWebpageEnabled(status.enabled);
        if (status.enabled) setWebpageFeedback(webpageProgressText(status));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!webpageEnabled) return;
    let disposed = false;
    const timer = setInterval(() => {
      void sendWebpageCommand('webpage:status').then((status) => {
        if (disposed) return;
        setWebpageEnabled(status.enabled);
        setWebpageFeedback(status.enabled ? webpageProgressText(status) : '网页翻译已关闭');
      }).catch(() => undefined);
    }, 1_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [webpageEnabled]);

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
            ? `区块对照已启用，共 ${status.count} 段；译文将显示在原文下方，失败段可点击重试`
            : '已关闭并移除译文，原文保留',
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
      // Request optional site access directly within the user's click gesture.
      const canResume = pdfStatus.enabled || await requestPdfResumePermission(pdfStatus.url);
      const next = await sendPdfWorkspaceCommand(pdfStatus.enabled ? 'disable' : 'enable');
      setPdfStatus(next);
      setPdfFeedback(next.enabled
        ? canResume ? '已记住此 PDF，刷新或重新打开会恢复阅读；关闭可取消自动恢复' : '本次已启用；未授予站点权限，重新打开时可能需要手动启用'
        : 'PDF 工作台已关闭；此文档不再自动开启');
    } catch (error) {
      setPdfFeedback(`操作失败：${errorText(error)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main>
      <header className="brand">
        <BrandLogo size={36} />
        <div><strong>Web Translate</strong><span>双语阅读助手</span></div>
      </header>
      <section className="reading-card" aria-labelledby="webpage-heading">
        <p className="eyebrow">{pdfStatus?.eligible ? 'PDF 文档' : '当前网页'}</p>
        {pdfStatus?.eligible ? <>
          <h1 id="webpage-heading">PDF 对照阅读</h1>
          <p className="description">原文与译文并排呈现，接着上次的位置继续读。</p>
          <button className="primary" type="button" disabled={pdfBusy} onClick={() => void togglePdfWorkspace()}>
            {pdfBusy ? '处理中…' : pdfStatus.enabled ? '关闭 PDF 工作台' : '翻译此 PDF'}
          </button>
          <p className="status" aria-live="polite">{pdfFeedback}</p>
          <p className="permission-note">允许当前站点访问后，可自动恢复已开启的 PDF。</p>
        </> : <>
          <h1 id="webpage-heading">网页对照翻译</h1>
          <p className="description">保留原文与排版，随阅读逐段呈现译文。</p>
          <button
            className="primary"
            type="button"
            disabled={webpageBusy}
            onClick={() => void toggleWebpage()}
          >
            {webpageBusy ? '处理中…' : webpageEnabled ? '关闭对照翻译' : '翻译当前网页'}
          </button>
          <p className="status" aria-live="polite">{pdfStatus === null ? pdfFeedback : webpageFeedback}</p>
        </>}
      </section>
      <button className="console-link" type="button" onClick={() => void browser.runtime.openOptionsPage()}>
        <span><strong>打开阅读控制台</strong><small>阅读记录与翻译设置</small></span>
        <span aria-hidden="true">→</span>
      </button>

      <details className="probe">
        <summary>遇到问题？<span>PDF 翻译诊断</span></summary>
        <p className="description">检查当前 PDF 的访问与加载情况，帮助定位无法翻译的原因。</p>
        <button type="button" disabled={running} onClick={() => void runProbe()}>
          {running ? '检查中…' : '检查当前 PDF'}
        </button>
        {output === null ? <p className="diagnostic-empty">尚未检查</p> : <pre aria-label="诊断详情">{output}</pre>}
      </details>
    </main>
  );
}

