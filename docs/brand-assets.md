# 品牌图标维护

## 唯一设计源

修改 `web-translate-plugin/public/brand/logo.svg`。保留正方形 viewBox，建议使用路径和纯色，避免依赖外部字体或网络资源。

弹窗、阅读控制台和页面 favicon 引用此 SVG；页面通过 `src/brand/BrandLogo.tsx` 共用同一组件。

## 更换步骤

1. 替换 `public/brand/logo.svg`。
2. 在插件目录执行 `npm run icons`，生成 Chrome 所需的 16、32、48、128 像素 PNG。首次开发需安装 Playwright Chromium：`npx playwright install chromium`。
3. 将 SVG 和生成的 PNG 一起提交，再运行正常构建流程。
4. 在 Chrome 重载原扩展，检查工具栏、扩展管理页、弹窗和控制台。

生成命令只读取本地图形，在隔离无头浏览器中渲染，不访问用户浏览器。普通构建使用已提交 PNG，无需额外启动浏览器。扩展与工具栏图标路径配置位于 `wxt.config.ts`，保持文件名时无需修改配置。

## 本次验收

- release 提交 `4d4080f`：统一工具栏、扩展管理图标、弹窗、控制台和 favicon，产品名称为 Web Translate。
- 独立复核无阻断问题；最终 manifest 的 action.default_title 已核对为 Web Translate。
- `npm run check` 通过：556 项测试、类型检查、构建与 4 种 PNG 尺寸验证。Vitest 19.57 秒，构建 3.499 秒。
- 弹窗与控制台 E2E 共 11 项通过，17 秒；已查看两处 logo 的实际截图。测试使用隔离浏览器，弹窗状态为固定测试数据，不代表原生权限验收。
- 固定验收目录已从 release 构建，重载原扩展即可查看。
