import React from 'react';

import type { LifecyclePhase } from './workspace-reducer';

export type WorkspaceFeedbackPlacement = 'toolbar' | 'notice';

export function workspaceFeedbackPlacement(
  phase: LifecyclePhase,
): WorkspaceFeedbackPlacement {
  return ['loading-pdf', 'awaiting-consent', 'uploading', 'parsing', 'failed'].includes(phase)
    ? 'notice'
    : 'toolbar';
}

export interface WorkspaceToolbarProps {
  title: string;
  activePage: number;
  pageCount: number;
  progressLabel: string;
  agentOpen: boolean;
  canRetryFailed: boolean;
  canStopAgent: boolean;
  onZoomOut(): void;
  onZoomIn(): void;
  onToggleAgent(): void;
  onRetryCurrent(): void;
  onRetryFailed(): void;
  onRetryParsing?(): void;
  onStopAgent(): void;
  onClearCache(): void;
  onOpenSettings(): void;
  onCloseWorkspace(): void;
}

export function WorkspaceToolbar({
  title,
  activePage,
  pageCount,
  progressLabel,
  agentOpen,
  canRetryFailed,
  canStopAgent,
  onZoomOut,
  onZoomIn,
  onToggleAgent,
  onRetryCurrent,
  onRetryFailed,
  onRetryParsing,
  onStopAgent,
  onClearCache,
  onOpenSettings,
  onCloseWorkspace,
}: WorkspaceToolbarProps) {
  return (
    <header className="workspace-toolbar">
      <strong className="workspace-title" title={title}>{title}</strong>
      <div className="workspace-page-controls" aria-label="页面与缩放控制">
        <span>{activePage} / {pageCount || '—'}</span>
        <button type="button" aria-label="缩小" onClick={onZoomOut}>−</button>
        <button type="button" aria-label="放大" onClick={onZoomIn}>+</button>
      </div>
      <span className="workspace-progress" aria-live="polite">{progressLabel}</span>
      <div className="workspace-toolbar-actions">
        <button
          type="button"
          className="workspace-agent-toggle"
          aria-expanded={agentOpen}
          onClick={onToggleAgent}
        >
          论文智能体
        </button>
        <details className="workspace-more-menu">
          <summary aria-label="更多操作">更多</summary>
          <div className="workspace-more-menu-items">
            <button type="button" onClick={onRetryCurrent}>重试当前页</button>
            <button type="button" disabled={!canRetryFailed} onClick={onRetryFailed}>重试失败页</button>
            {onRetryParsing && <button type="button" onClick={onRetryParsing}>重试解析</button>}
            <button type="button" disabled={!canStopAgent} onClick={onStopAgent}>取消当前任务</button>
            <button type="button" onClick={onClearCache}>清理本文缓存</button>
            <button type="button" onClick={onOpenSettings}>设置</button>
            <button type="button" onClick={onCloseWorkspace}>关闭工作台</button>
          </div>
        </details>
      </div>
    </header>
  );
}
