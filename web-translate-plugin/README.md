# Web Translate 浏览器扩展

这是一个 Chrome MV3 扩展，支持普通网页翻译，以及保留原 URL 的 PDF 双栏阅读、逐页翻译和论文问答。PDF 左栏由 PDF.js 渲染，右栏显示 MinerU 解析后的结构化内容与 OpenAI 兼容接口生成的译文。

## 构建与加载

需要 Node.js 和 npm。进入本目录后执行：

```powershell
npm install
npm run build
```

构建产物位于 `.output/chrome-mv3`。在 Chrome 打开 `chrome://extensions`，开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择该目录。源码变化后重新执行 `npm run build`，并在扩展管理页点击刷新。

## Provider 设置与 Origin 授权

从扩展 Popup 点击“Provider 设置”，填写 OpenAI 兼容接口地址、模型和 API Key；需要 PDF 解析时，再填写 MinerU 接口地址、Token 和模型版本。Provider 接口地址必须是 HTTPS。

保存或测试连接时，Chrome 会请求对应 Provider 精确 Origin 的访问权限。凭据保存在扩展本地存储中，Provider 请求由扩展后台发出。不要把 API Key 或 Token 填入网页表单、PDF 页面或聊天问题中。

## 普通网页翻译

打开 HTTP/HTTPS 网页，点击扩展图标，在 Popup 中启用普通网页翻译。再次点击关闭后恢复原文。敏感页面、浏览器内部页面、PDF 或不允许脚本注入的页面不会启用普通网页翻译。

## arXiv 与其他 HTTP/HTTPS PDF

打开 arXiv PDF、以 `.pdf` 结尾的地址，或响应类型为 `application/pdf` 的通用下载地址，然后点击扩展图标并选择“翻译此 PDF”。首次对该站点使用时，Chrome 可能要求站点访问授权。

工作台保持地址栏中的原 URL、query 和 fragment，不跳转到扩展页面。左栏可独立阅读；MinerU 解析完成后，右栏按当前页优先翻译。论文智能体只使用当前论文上下文回答，并把合法的 `[p:N]` 引用显示为页码按钮；点击引用会同步定位左右栏。

点击“关闭工作台”会恢复并刷新原生 PDF 页面。刷新、历史导航、复制标签页和新标签页不会把 URL 改写为扩展 URL。

## 需要登录的 PDF 与上传同意

扩展先尝试无凭据读取 PDF，再在必要时带当前站点凭据读取。若只有带凭据请求才能获得真实 PDF，工作台会把来源标记为认证 PDF。

认证 PDF 的左栏仍可阅读，但在你点击“同意并上传到 MinerU”之前，不会创建 MinerU 批量上传任务，也不会上传文件字节。同意区会显示目标服务、文件名和大小；PDF.js 页数准备完成前，同意按钮保持禁用。

## 本地文件

`file://` 本地 PDF 仍属于后续能力，不在当前产品支持范围内。即使 Chrome 的“允许访问文件网址”开关可见，也不要把它视为当前版本已支持本地文件。

## 常见问题

- Popup 显示当前页面不是支持的 PDF：确认页面确实返回 `application/pdf`，并在当前 PDF 标签页重新打开 Popup。
- Provider 配置不完整或连接失败：检查 HTTPS 接口地址、模型、API Key、MinerU Token，以及 Chrome 是否授予对应 Origin 权限。
- MinerU 解析失败：左栏不受影响，可使用“重试解析”；持续失败时检查 Token、服务状态和响应格式。
- 某页翻译失败：可重试当前页或全部失败页。401/403 通常需要修正凭据；429/5xx 会有限重试。
- 工作台无法加载：重新执行 `npm run build`、在扩展管理页刷新扩展，并确认加载的是 `.output/chrome-mv3`。
- 关闭后页面异常：刷新原 PDF 标签页；原 URL 应保持不变。

## 开发验证

```powershell
npm test -- tests/unit/pdf/workspace-service.test.ts
npm run test:e2e -- pdf-workspace.spec.ts
```

完整发布门禁由项目维护流程统一执行：`npm run check`。
