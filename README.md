<img src="web-translate-plugin/public/brand/logo.svg" width="64" height="64" alt="Web Translate logo" />

# Web Translate

一个面向网页与论文阅读的 Chrome 扩展：保留原文，提供双语对照翻译。

## 功能

- **网页对照翻译**：按标题、段落、列表等语义块翻译，保留排版、加粗和链接；随阅读位置预取，支持动态内容和本地译文缓存。
- **PDF 阅读工作台**：原文与译文并排显示，按需翻译，恢复阅读位置，并支持带页码引用的论文问答。
- **论文库**：收藏论文、管理嵌套文件夹，搜索并继续阅读。
- **阅读控制台**：配置模型与解析服务，管理历史记录，查看本地存储占用。

## 安装与使用

需要 Node.js 24、npm 和 Chrome 120 或更新版本。

```bash
git clone https://github.com/sudowind/web-translator.git
cd web-translator/web-translate-plugin
npm ci
npm run build
```

1. 打开 Chrome 的 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择 `web-translate-plugin/.output/chrome-mv3`。
3. 点击扩展图标 →「打开阅读控制台」，在「AI 服务」中填写 OpenAI 兼容接口地址、API Key 和模型；使用 PDF 功能还需在「PDF 解析」中配置 MinerU。
4. 打开网页或 PDF，点击扩展中的翻译按钮，按提示授予所需权限。

更新后重新构建并重载原扩展即可，无需卸载或清空配置。

## 数据与服务

配置、历史、收藏和译文缓存在浏览器本地保存。翻译与问答会将相关内容发送到你配置的模型服务，PDF 解析会向配置的 MinerU 服务提交 PDF 地址或上传文件内容。服务可能产生费用。PDF 缓存不包含完整原始文件，不等同于离线论文归档。

## 开发

在 `web-translate-plugin` 目录运行：

```bash
npm run dev        # 开发模式
npm run check      # 类型检查、单元测试、构建与产物校验
npx playwright install chromium
npm run test:e2e   # 浏览器测试
npm run icons      # 从统一 SVG 生成扩展图标
```

技术栈：WXT · React · TypeScript · PDF.js · IndexedDB。

图标替换见 [品牌资源维护](docs/brand-assets.md)，开发与验收约定见 [协作流程](docs/release-validation-workflow.md)。

