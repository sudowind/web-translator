# PDF 大文件源字节生命周期设计

## 背景与问题

当前后台通过 `pdf:source` 读取完整 PDF，并把字节转换为 `number[]` 发送到内容脚本。内容脚本为了启动 MinerU 解析，又把包含同一份 `bytes` 的 `PdfSourceTransfer` 通过 `pdf:parse-start` 完整发回后台。

这会让大 PDF 在扩展消息边界发生两次完整序列化，并让内容脚本长期同时保留 `number[]` 与 `Uint8Array`。即使不依赖具体浏览器消息上限，也会放大内存、复制和主线程序列化成本。

## 目标

- `pdf:parse-start` 只发送 URL、hash、标题、大小、来源类型、页数和同意状态，不再携带 PDF 字节。
- 后台在 `pdf:source` 成功后按标签页临时保留源字节，供认证上传或公共 URL 失败后的单次上传回退使用。
- 唯一保留的后台到内容脚本传输使用 Base64 字符串，不再把每个字节展开为 `number[]`。
- 内容脚本收到源数据后立即把 Base64 解码成 `Uint8Array`，React 状态不长期保留编码字符串。
- 后台开始解析后释放临时源字节；标签页取消、关闭、导航或关闭工作台时同样释放。
- Service Worker 重启导致临时字节丢失时，只在实际需要上传时重新读取 URL，并核对 SHA-256，禁止上传与工作台初始内容不一致的文件。

## 非目标

- 本次不改变首次后台到内容脚本的 PDF 字节传输协议。
- 本次不实现分块传输、流式 PDF.js 加载或新的文件大小上限。
- 本次不新增 `file://` 支持。
- 本次不改变 MinerU URL 任务优先、认证 PDF 明确同意、公共 URL 失败最多回退一次上传的行为。

## 数据模型

新增不含字节的 `PdfSourceDescriptor`：

- `url`
- `hash`
- `title`
- `size`
- `kind`

`PdfSourceTransfer` 在描述信息基础上增加 `bytesBase64`，只作为 `pdf:source` 的后台到内容脚本响应。`pdf:parse-start.source` 必须是精确的 `PdfSourceDescriptor`，出现 `bytes`、`bytesBase64` 或其他未知字段时消息校验失败。

## 后台生命周期

`PdfWorkspaceService` 维护按 `tabId` 索引的临时源记录：

1. `pdf:source` 成功：替换该标签页的旧记录并返回源数据。
2. `pdf:parse-start`：
   - 当前文档缓存有效时直接返回，不读取或上传字节；
   - 公共源先创建 MinerU URL 任务；
   - 只有认证上传或公共 URL 回退时才读取临时字节；
   - 临时记录不存在时重新调用 `loadSource(url)`；
   - 重取结果的 hash 与描述信息不一致时返回 `PDF_SOURCE_CHANGED`。
3. 解析请求结束：释放该标签页临时源记录。
4. `pdf:cancel`、标签页关闭、标签页导航和关闭工作台：取消请求并释放记录。
5. `pdf:cache-clear`：取消正在执行的请求，但不依赖消息中的字节；后续重新解析可按 URL 安全重取。

## 内容脚本生命周期

工作台分别保存：

- `source: PdfSourceDescriptor | null`
- `pdfBytes: Uint8Array | null`

收到 `PdfSourceTransfer` 后立即解码并拆分，`source` 不包含 `bytesBase64`。PDF.js 继续使用 `pdfBytes`，上传同意区继续使用描述信息。`pdf:parse-start` 只能序列化描述信息。

## 错误与安全

- 重取 hash 不一致返回稳定错误码 `PDF_SOURCE_CHANGED`，不得把新文件上传到 MinerU。
- 消息校验继续拒绝未知键、凭据和越界页数。
- API Key、MinerU Token、PDF 正文和 Provider 原始响应不得进入新增状态、日志或诊断。
- 认证 PDF 未同意时不得为上传目的重新读取或创建上传任务。

## 测试与验收

- 源读取测试证明 Base64 往返后字节与长度保持一致。
- 消息测试证明不含字节的 `pdf:parse-start` 合法，包含 `bytes` 或 `bytesBase64` 的同类消息被拒绝。
- 服务测试证明 `pdf:source` 只读取一次，公共 URL 回退上传复用临时字节。
- 服务测试证明没有临时记录时会安全重取，hash 不一致时拒绝上传。
- 组件测试或静态契约证明工作台发送的 `pdf:parse-start` 不含 `bytes`。
- 现有公开 PDF、认证 PDF、失败诊断、缓存竞态和 Agent 测试继续通过。
- `npm run check` 与 `npm run test:e2e -- pdf-workspace.spec.ts` 通过。
