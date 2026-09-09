import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      minify: 'esbuild',
    },
    plugins: [{
      name: 'escape-unicode-noncharacters',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          output.code = output.code.replace(
            /[\uFDD0-\uFDEF\uFFFE\uFFFF]/gu,
            (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
          );
        }
      },
    }],
  }),
  manifest: {
    name: 'Web Translate',
    minimum_chrome_version: '120',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    icons: { 16: 'brand/icon-16.png', 32: 'brand/icon-32.png', 48: 'brand/icon-48.png', 128: 'brand/icon-128.png' },
    action: {
      default_title: 'Web Translate',
      default_icon: { 16: 'brand/icon-16.png', 32: 'brand/icon-32.png' },
    },
  },
});
