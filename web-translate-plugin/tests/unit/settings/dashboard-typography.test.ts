import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../entrypoints/options/style.css', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../../entrypoints/options/Dashboard.tsx', import.meta.url), 'utf8');

describe('控制台阅读字号约束', () => {
  it('字号使用相对单位且不通过整页缩放放大', () => {
    expect(css).toMatch(/font: 100%\/1\.6/);
    expect(css).toContain('--text-small: .875rem');
    expect(css).toMatch(/body\s*\{[^}]*font-size: var\(--text-body\)/);
    expect(css).not.toMatch(/font(?:-size)?:[^;\n]*\dpx/);
    expect(css).not.toMatch(/(?:^|[;{])\s*(?:zoom|transform):/);
  });

  it('长标题不截断，进度文字处于正常文档流', () => {
    expect(css).not.toContain('text-overflow: ellipsis');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(dashboard).toContain('className="reading-progress-track"');
    expect(css).not.toMatch(/\.reading-progress small\s*\{[^}]*position: absolute/);
  });
});
