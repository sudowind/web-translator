import React from 'react';

import type { TranslationMode } from '../translation/page-scheduler';
import type { PdfThemePreference } from './theme';
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
  scale: number;
  progressLabel: string;
  agentOpen: boolean;
  themePreference: PdfThemePreference;
  canRetryFailed: boolean;
  canStopAgent: boolean;
  translationMode: TranslationMode;
  onNavigatePage(page: number): void;
  onChangeTranslationMode(mode: TranslationMode): void;
  onZoomOut(): void;
  onZoomIn(): void;
  onToggleAgent(): void;
  onChangeTheme(theme: PdfThemePreference): void;
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
  scale,
  progressLabel,
  agentOpen,
  themePreference,
  canRetryFailed,
  canStopAgent,
  translationMode,
  onNavigatePage,
  onChangeTranslationMode,
  onZoomOut,
  onZoomIn,
  onToggleAgent,
  onChangeTheme,
  onRetryCurrent,
  onRetryFailed,
  onRetryParsing,
  onStopAgent,
  onClearCache,
  onOpenSettings,
  onCloseWorkspace,
}: WorkspaceToolbarProps) {
  return (
    <header className="workspace-toolbar" data-translation-mode={translationMode}>
      <h1 className="workspace-title" title={title}>{title}</h1>
      <div className="workspace-page-controls" aria-label="页面与缩放控制">
        <PageNavigator
          activePage={activePage}
          pageCount={pageCount}
          onNavigatePage={onNavigatePage}
        />
        <span className="workspace-control-divider" aria-hidden="true" />
        <div className="workspace-zoom-controls" aria-label="缩放控制">
          <button type="button" className="workspace-icon-button" aria-label="缩小" onClick={onZoomOut}>
            <ToolbarIcon name="minus" />
          </button>
          <output className="workspace-zoom-value" aria-label="当前缩放比例">{Math.round(scale * 100)}%</output>
          <button type="button" className="workspace-icon-button" aria-label="放大" onClick={onZoomIn}>
            <ToolbarIcon name="plus" />
          </button>
        </div>
      </div>
      <span className="workspace-progress" aria-live="polite">{progressLabel}</span>
      <div className="workspace-toolbar-actions">
        <button
          type="button"
          className="workspace-agent-toggle"
          aria-expanded={agentOpen}
          aria-label="论文智能体"
          onClick={onToggleAgent}
        >
          <ToolbarIcon name="spark" />
          <span className="workspace-agent-toggle-label">论文智能体</span>
        </button>
        <MoreMenu
          canRetryFailed={canRetryFailed}
          canStopAgent={canStopAgent}
          translationMode={translationMode}
          themePreference={themePreference}
          onChangeTranslationMode={onChangeTranslationMode}
          onChangeTheme={onChangeTheme}
          onZoomOut={onZoomOut}
          onZoomIn={onZoomIn}
          onRetryCurrent={onRetryCurrent}
          onRetryFailed={onRetryFailed}
          onRetryParsing={onRetryParsing}
          onStopAgent={onStopAgent}
          onClearCache={onClearCache}
          onOpenSettings={onOpenSettings}
          onCloseWorkspace={onCloseWorkspace}
        />
      </div>
    </header>
  );
}

function PageNavigator({
  activePage,
  pageCount,
  onNavigatePage,
}: {
  activePage: number;
  pageCount: number;
  onNavigatePage(page: number): void;
}) {
  const [draft, setDraft] = React.useState(String(activePage));
  React.useEffect(() => setDraft(String(activePage)), [activePage]);

  const commit = React.useCallback(() => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || pageCount < 1) {
      setDraft(String(activePage));
      return;
    }
    const page = Math.max(1, Math.min(pageCount, parsed));
    setDraft(String(page));
    if (page !== activePage) onNavigatePage(page);
  }, [activePage, draft, onNavigatePage, pageCount]);

  return (
    <form className="workspace-page-navigator" onSubmit={(event) => {
      event.preventDefault();
      commit();
    }}>
      <button
        type="button"
        className="workspace-icon-button"
        aria-label="上一页"
        disabled={pageCount < 1 || activePage <= 1}
        onClick={() => onNavigatePage(activePage - 1)}
      >
        <ToolbarIcon name="previous" />
      </button>
      <label className="workspace-page-input-label">
        <span className="visually-hidden">跳转页码</span>
        <input
          aria-label="跳转页码"
          inputMode="numeric"
          min={1}
          max={Math.max(1, pageCount)}
          value={draft}
          disabled={pageCount < 1}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            setDraft(String(activePage));
            event.currentTarget.blur();
          }}
        />
      </label>
      <span className="workspace-page-total" aria-hidden="true">/ {pageCount || '—'}</span>
      <button
        type="button"
        className="workspace-icon-button"
        aria-label="下一页"
        disabled={pageCount < 1 || activePage >= pageCount}
        onClick={() => onNavigatePage(activePage + 1)}
      >
        <ToolbarIcon name="next" />
      </button>
    </form>
  );
}

function MoreMenu({
  canRetryFailed,
  canStopAgent,
  translationMode,
  themePreference,
  onChangeTranslationMode,
  onChangeTheme,
  onZoomOut,
  onZoomIn,
  onRetryCurrent,
  onRetryFailed,
  onRetryParsing,
  onStopAgent,
  onClearCache,
  onOpenSettings,
  onCloseWorkspace,
}: Pick<
  WorkspaceToolbarProps,
  | 'canRetryFailed'
  | 'canStopAgent'
  | 'translationMode'
  | 'themePreference'
  | 'onZoomOut'
  | 'onZoomIn'
  | 'onRetryCurrent'
  | 'onRetryFailed'
  | 'onRetryParsing'
  | 'onStopAgent'
  | 'onClearCache'
  | 'onOpenSettings'
  | 'onCloseWorkspace'
  | 'onChangeTranslationMode'
  | 'onChangeTheme'
>) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="workspace-more-menu">
      <button
        type="button"
        className="workspace-more-trigger workspace-icon-button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="pdf-workspace-more-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <ToolbarIcon name="more" />
      </button>
      {open && (
        <div id="pdf-workspace-more-menu" className="workspace-more-menu-items" role="menu">
          <MenuButton onClick={() => run(() => onChangeTranslationMode(
            translationMode === 'on-demand' ? 'full-document' : 'on-demand',
          ))}>{translationMode === 'on-demand' ? '翻译全文' : '改为按需'}</MenuButton>
          <div className="workspace-menu-section" role="group" aria-label="外观">
            <span className="workspace-menu-section-label">外观</span>
            {([
              ['system', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={themePreference === value}
                className="workspace-theme-choice"
                onClick={() => run(() => onChangeTheme(value))}
              >
                <span className="workspace-choice-mark" aria-hidden="true">{themePreference === value ? '✓' : ''}</span>
                {label}
              </button>
            ))}
          </div>
          <MenuButton className="workspace-mobile-menu-action" onClick={() => run(onZoomOut)}>缩小页面</MenuButton>
          <MenuButton className="workspace-mobile-menu-action" onClick={() => run(onZoomIn)}>放大页面</MenuButton>
          <MenuButton onClick={() => run(onRetryCurrent)}>重试当前页</MenuButton>
          <MenuButton disabled={!canRetryFailed} onClick={() => run(onRetryFailed)}>重试失败页</MenuButton>
          {onRetryParsing && <MenuButton onClick={() => run(onRetryParsing)}>重试解析</MenuButton>}
          <MenuButton disabled={!canStopAgent} onClick={() => run(onStopAgent)}>取消当前任务</MenuButton>
          <MenuButton onClick={() => run(onClearCache)}>清理本文缓存</MenuButton>
          <MenuButton onClick={() => run(onOpenSettings)}>设置</MenuButton>
          <MenuButton onClick={() => run(onCloseWorkspace)}>关闭工作台</MenuButton>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  children,
  className,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return <button type="button" role="menuitem" className={className} disabled={disabled} onClick={onClick}>{children}</button>;
}

function ToolbarIcon({ name }: {
  name: 'previous' | 'next' | 'minus' | 'plus' | 'spark' | 'more';
}) {
  const path = {
    previous: <path d="m15 18-6-6 6-6" />,
    next: <path d="m9 18 6-6-6-6" />,
    minus: <path d="M6 12h12" />,
    plus: <><path d="M6 12h12" /><path d="M12 6v12" /></>,
    spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></>,
    more: <><circle cx="6" cy="12" r="1.25" /><circle cx="12" cy="12" r="1.25" /><circle cx="18" cy="12" r="1.25" /></>,
  }[name];
  return (
    <svg className="workspace-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      {path}
    </svg>
  );
}
