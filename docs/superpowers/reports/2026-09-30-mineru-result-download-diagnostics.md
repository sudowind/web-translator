# MinerU 结果下载失败排查与诊断修复

## 范围与状态

- 工作分支：`codex/independent-provider-settings`，基线 `24febfe`。
- 保留此前的 LLM / MinerU 独立保存修复及用户已有 `.DS_Store` 文件。

## 实际失败证据

用户的 Chrome Network 截图显示：创建解析任务及轮询之后，对 `cdn-mineru.openxlab.org.cn` 的 ZIP 结果下载失败，未显示 HTTP 响应状态。

对截图中同一地址进行无 Token 的只读 HEAD 请求：

- 当前 `127.0.0.1:7890` 代理路径：代理隧道建立后 TLS 握手失败，curl 返回 `SSL_ERROR_SYSCALL`。
- 仅对此次请求使用 `--noproxy '*'`：返回 `HTTP 200 OK`，类型为 `application/zip`，大小 16,881,053 字节。
- `scutil --proxy` 与 `networksetup` 确认 Wi-Fi 系统 HTTP / HTTPS / SOCKS 代理均使用同一地址。

据此定位到结果 CDN 的代理网络路径，而非 MinerU Token 或任务创建失败。

## 经用户授权的环境修复

仅在 Wi-Fi 的系统代理绕过名单中追加 `cdn-mineru.openxlab.org.cn`，实时读取并保留全部原有条目。修改后已通过 `networksetup -getproxybypassdomains Wi-Fi` 与 `scutil --proxy` 验证生效。

原始名单备份位于 `/private/tmp/web-translator-wifi-proxy-bypass-before.json`。若需撤销，在当前名单中移除本次增加的单个域名即可；不要覆盖其他后续网络设置。未改动代理软件规则、代理服务器或浏览器存储。

## 代码修复

- MinerU 客户端识别已知 Token、额度、文件限制及排队错误；不保留或输出响应正文。
- 后台向 PDF 页面保留脱敏错误码和 HTTP 状态，页面展示可操作的中文提示。
- 结果 CDN 网络失败明确提示下载域名、代理及站点访问权限；结果下载 HTTP 401 不误报为 API Token 错误。
- 已知认证、额度、文件限制错误不再无效回退上传；其他回退及认证 PDF 上传同意门禁保持。
- 不记录 Token、原始服务错误文字、私有 PDF 地址或签名下载链接。
- 错误码参考：[MinerU 官方 API 文档](https://mineru.net/apiManage/docs)。

## 验证

以下证据来自本次修复的工作树；提交前仅整理报告，代码与验证时保持一致：

- 定向：`npm test -- tests/unit/providers/mineru tests/unit/pdf/workspace-service.test.ts`，4 文件、72 测试通过。
- 诊断提示修正：`npm test -- tests/unit/providers/mineru/diagnostics.test.ts`，4 测试通过。
- 最终门禁：`npm run check`，类型检查、83 文件 / 574 单元测试、生产构建及产物校验通过。
- 浏览器回归：`PLAYWRIGHT_BROWSERS_PATH=/private/tmp/web-translator-playwright npm run test:e2e -- pdf-workspace.spec.ts --grep 'MinerU 鉴权失败|认证 PDF 在用户同意前不上传'`，2 测试通过。
- 浏览器回归使用独立临时配置和授权测试路径，不替代真实 action Popup、activeTab 或原生权限弹窗验收。
- 独立复核无 Critical / Important；结果下载 HTTP 提示的 Minor 已修复并由同一 reviewer 关闭。

完整日志：`/private/tmp/web-translator-mineru-check.log`、`/private/tmp/web-translator-mineru-e2e.log`。

## 人工验证

等待用户在原 PDF 页重试，确认系统代理例外生效后结果下载与解析恢复。computer use 能识别 DevTools 窗口，但无法读取其内容或截图；当前浏览器标签页连接也超时，未将自动化模拟结果当作用户环境成功证据。
