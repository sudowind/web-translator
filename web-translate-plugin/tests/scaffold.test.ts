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
    expect(background).toContain('browser.runtime.onMessage.addListener');
    expect(background).not.toContain('addListener(async');
    expect(background).toContain('sendResponse');
    expect(background).toContain('return true');
    expect(background).toContain("message.type === 'pdf-probe:run'");
    expect(background).toContain("message.type === 'pdf-probe:restore'");
    expect(background).toContain("message.type === 'pdf-probe:latest'");
    expect(background).toContain('browser.tabs.query');
    expect(background).toContain('browser.scripting.executeScript');
    expect(background).toContain('catch (error)');
    expect(background).toContain('await restore(tab.id)');
  });

  it('以 zh-CN 页面展示探针标题、操作按钮与全部状态文案', async () => {
    const [html, app] = await Promise.all([
      readProjectFile('entrypoints/popup/index.html'),
      readProjectFile('entrypoints/popup/App.tsx'),
    ]);

    expect(html).toContain('<html lang="zh-CN">');
    expect(app).toContain('<h1>PDF 接管探针</h1>');
    expect(app).toContain('运行探针');
    expect(app).toContain('运行中…');
    expect(app).toContain('尚未运行');
    expect(app).toContain("type: 'pdf-probe:latest'");
    expect(app).toContain("type: 'pdf-probe:run'");
    expect(app).toContain('response.ok');
    expect(app).toContain('<pre>');
  });
});
