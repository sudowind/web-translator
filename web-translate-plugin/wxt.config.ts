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
    name: 'Web Translate Probe',
    minimum_chrome_version: '120',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    action: { default_title: 'PDF 接管探针' },
  },
});
