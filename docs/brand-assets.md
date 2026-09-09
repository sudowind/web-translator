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
