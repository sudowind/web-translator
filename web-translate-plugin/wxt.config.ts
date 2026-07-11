import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Web Translate Probe',
    minimum_chrome_version: '120',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    action: { default_title: 'PDF 接管探针' },
  },
});
