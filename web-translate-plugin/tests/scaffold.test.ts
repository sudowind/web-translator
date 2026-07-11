import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

  it('Popup 不静态请求 HTTP 权限并保留探针操作', async () => {
    const app = await readProjectFile('entrypoints/popup/App.tsx');

    expect(app).not.toContain('browser.permissions.request');
    expect(app).toContain("type: 'pdf-probe:run'");
  });

  it('runtime content script 使用 pdfjs-dist 真实渲染第一页', async () => {
    const rendererPath = 'entrypoints/pdf-probe-renderer.content.ts';

    expect(existsSync(resolve(process.cwd(), rendererPath))).toBe(true);
    const [renderer, helper, packageJson] = await Promise.all([
      readProjectFile(rendererPath),
      readProjectFile('src/pdf-takeover/render-first-page.ts'),
      readProjectFile('package.json'),
    ]);
    expect(renderer).toContain("from 'pdfjs-dist/legacy/build/pdf.mjs'");
    expect(helper).toContain('rendererVerified');
    expect(JSON.parse(packageJson).dependencies?.['pdfjs-dist']).toBeTruthy();
  });

  it('E2E 走 Popup 按钮与生产权限路径并覆盖浏览器导航语义', async () => {
    const e2e = await readProjectFile('tests/e2e/pdf-takeover.spec.ts');

    expect(e2e).toContain('授权后技术矩阵（不代表生产权限 gate）');
    expect(e2e).toContain('testExtensionPath');
    expect(e2e).toContain('manifest.host_permissions');
    expect(e2e).toContain('.reload(');
    expect(e2e).toContain('.goBack(');
    expect(e2e).toContain('.goForward(');
    expect(e2e).toContain('tabs.duplicate');
    expect(e2e).toContain('context.newPage()');
  });
});
