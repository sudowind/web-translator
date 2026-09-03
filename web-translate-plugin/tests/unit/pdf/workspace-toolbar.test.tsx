import React from 'react';
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
});
