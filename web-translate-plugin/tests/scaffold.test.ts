import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), 'utf8');

describe('Chrome 扩展探针骨架', () => {
  it('为 React 入口启用 JSX 转换', async () => {
    const tsconfig = await readProjectFile('tsconfig.json');

    expect(JSON.parse(tsconfig).compilerOptions?.jsx).toBe('react-jsx');
  });

  it('声明 WXT React 模块、Chrome 120 和所需权限', async () => {
    const config = await readProjectFile('wxt.config.ts');

    expect(config).toContain("modules: ['@wxt-dev/module-react']");
    expect(config).toContain("minimum_chrome_version: '120'");
    expect(config).toContain("permissions: ['activeTab', 'scripting', 'storage', 'tabs']");
    expect(config).toContain("optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*']");
  });

  it('注册最小后台入口并输出就绪消息', async () => {
    const background = await readProjectFile('entrypoints/background.ts');

    expect(background).toContain('defineBackground');
    expect(background).toContain('PDF takeover probe ready');
  });

  it('以 zh-CN 页面展示唯一的探针标题', async () => {
    const [html, app] = await Promise.all([
      readProjectFile('entrypoints/popup/index.html'),
      readProjectFile('entrypoints/popup/App.tsx'),
    ]);

    expect(html).toContain('<html lang="zh-CN">');
    expect(app).toContain('<h1>PDF 接管探针</h1>');
  });
});
