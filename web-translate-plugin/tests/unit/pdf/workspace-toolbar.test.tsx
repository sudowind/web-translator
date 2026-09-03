// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceToolbar,
  workspaceFeedbackPlacement,
} from '../../../src/pdf/WorkspaceToolbar';

const actions = {
  onNavigatePage: vi.fn(),
  onChangeTranslationMode: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomIn: vi.fn(),
  onToggleAgent: vi.fn(),
  onRetryCurrent: vi.fn(),
  onRetryFailed: vi.fn(),
  onStopAgent: vi.fn(),
  onClearCache: vi.fn(),
  onOpenSettings: vi.fn(),
  onCloseWorkspace: vi.fn(),
};

describe('PDF 极简工具栏', () => {
  it('只直接展示高频操作并把次要操作放入更多菜单', () => {
    const html = renderToStaticMarkup(<WorkspaceToolbar
      title="Attention Is All You Need"
      activePage={4}
      pageCount={15}
      scale={1.1}
      progressLabel="已完成 4/15 页 · 翻译中 2 页 · 失败 0 页"
      agentOpen={false}
      canRetryFailed={false}
      canStopAgent={false}
      translationMode="on-demand"
      {...actions}
    />);

    expect(html).toContain('Attention Is All You Need');
    expect(html).toContain('value="4"');
    expect(html).toContain('/ 15');
    expect(html).toContain('aria-label="上一页"');
    expect(html).toContain('aria-label="跳转页码"');
    expect(html).toContain('aria-label="下一页"');
    expect(html).toContain('aria-label="缩小"');
    expect(html).toContain('aria-label="放大"');
    expect(html).toContain('110%');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('论文智能体');
    expect(html).not.toContain('<details');
    expect(html).toContain('更多操作');
    expect(html).not.toContain('重试当前页');
  });

  it('只把需要用户关注的生命周期反馈放到独立提示区', () => {
    expect(workspaceFeedbackPlacement('parsing')).toBe('notice');
    expect(workspaceFeedbackPlacement('failed')).toBe('notice');
    expect(workspaceFeedbackPlacement('translating')).toBe('toolbar');
    expect(workspaceFeedbackPlacement('ready')).toBe('toolbar');
    expect(workspaceFeedbackPlacement('idle')).toBe('toolbar');
  });

  it('更多菜单可以在按需与全文模式之间显式切换', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<WorkspaceToolbar
      title="Long Paper" activePage={40} pageCount={76} scale={1}
      progressLabel="当前页已完成 · 已缓存 4/76 页 · 正在预取 0 页"
      agentOpen={false} canRetryFailed={false} canStopAgent={false}
      translationMode="on-demand" {...actions}
    />));

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!.click());
    const modeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === '翻译全文')!;
    expect(modeButton).toBeDefined();
    await act(async () => modeButton.click());
    expect(actions.onChangeTranslationMode).toHaveBeenCalledWith('full-document');
    await act(async () => root.unmount());
  });
});
