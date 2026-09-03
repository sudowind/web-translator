# PDF 大文件源字节生命周期实施计划

状态：已完成（2026-07-23）

**目标：** 移除 `pdf:parse-start` 的完整 PDF 字节回传，并把唯一保留的后台到内容脚本传输从 `number[]` 改为 Base64，同时保留认证同意、公共 URL 回退、任务恢复和缓存竞态语义。

**架构：** 消息层拆分 `PdfSourceDescriptor` 与 `PdfSourceTransfer`；传输对象使用 `bytesBase64`；后台按标签页短暂缓存传输对象，仅在上传路径解码取用，缺失时按 URL 重取并校验 hash；React 将 Base64 立即解码为 `Uint8Array`，解析消息只传描述信息。

## 全局约束

- 规格和计划正文使用中文。
- 先写消息与服务失败测试，再修改实现。
- 开发阶段只运行受影响的 PDF 定向测试；完成全部修复后运行一次完整 `npm run check` 和一次 PDF E2E。
- 不修改 MinerU/OpenAI 协议，不新增 `file://`，不降低认证上传同意门禁。

## 任务 1：收紧消息协议

- [x] 增加 `PdfSourceDescriptor`，让 `PdfSourceTransfer` 继承描述信息并追加字节。
- [x] 把 `PdfSourceTransfer` 的字节载荷改为 Base64，并验证编码解码往返。
- [x] 把 `pdf:parse-start.source` 改为不含字节的精确描述信息。
- [x] 增加“包含 bytes 必须拒绝”的消息回归测试。

## 任务 2：实现后台临时字节生命周期

- [x] `pdf:source` 成功后按 `tabId` 暂存源数据。
- [x] 认证上传与公共 URL 回退优先复用暂存字节。
- [x] 暂存缺失时按 URL 重取，并在 hash 不一致时返回 `PDF_SOURCE_CHANGED`。
- [x] 解析结束、取消、关闭和导航时释放临时记录。
- [x] 补充复用、重取、hash 变化和既有缓存竞态测试。

## 任务 3：缩短内容脚本字节状态

- [x] React 状态拆分为 `PdfSourceDescriptor` 与 `Uint8Array`。
- [x] `pdf:parse-start` 只发送描述信息。
- [x] 保持 PDF.js 阅读、认证同意信息和清缓存交互不变。

## 任务 4：修正文档与构建保护

- [x] 把 Popup、README 和旧实施报告中的“当前页优先”改为“从第 1 页顺序翻译”。
- [x] 回填本计划状态，并在实施报告记录新鲜验证结果。
- [x] 消除或收敛 WXT/Vite 的 esbuild/OXC 配置覆盖警告，同时保留产物非字符扫描。

## 任务 5：验证

- [x] 运行受影响的消息、服务、组件和后台定向测试。
- [x] 运行一次 `npm run check`。
- [x] 对新生产构建运行一次 `npm run test:e2e -- pdf-workspace.spec.ts`。
- [x] 扫描生产 JS/CSS/HTML/JSON，确认 `U+FFFF` 为 0，并检查 manifest 无静态 host 权限和静态 content script。
- [x] 确认工作树只包含本次范围内修改。
