# PDF 工作台产品里程碑实施报告

## 第一顺序批次：正式接管与双栏翻译壳

### 范围

本批次完成正式 PDF runtime 接管、PDF.js 左栏、逐页译文右栏、当前页优先调度、双栏同步、后台 Provider/缓存接线和 Popup 最小正式启停入口。

本批次按控制器收窄范围，不实现智能体、任务恢复或认证 PDF 的第三方上传同意编排。认证 PDF 可在左栏阅读，但明确提示上传同意能力属于后续批次；没有绕过同意门禁调用上传端点。

### 实现摘要

- 新增精确判别的 PDF 内容脚本消息校验，拒绝未知键、越界页码与凭据字段。
- 新增正式 `ChromePdfTakeoverAdapter`，只注入固定 runtime bundle `/content-scripts/pdf-workspace.js`，挂载前后校验 URL 逐字一致；关闭先卸载内容脚本工作台，再 reload 当前标签恢复原生 PDF 查看器，并复核 URL 未变化。
- 新增 PDF 源读取：先无凭据读取，失败后才带凭据重试，并根据真实读取结果保守分类为公共或认证源；校验 PDF 签名并生成 SHA-256。
- PDF.js 使用后台取得的字节加载。页面先创建占位，仅渲染当前页与相邻页；活动页变化时更新小窗口。卸载时销毁 loading task、取消 render task、断开 observer，并提供可选择文本层。
- 双栏分别输出 `data-pdf-page="N"`、`data-translation-page="N"` 和译文 `data-status`。同步使用页锚点和页内相对进度，并用程序滚动锁防反馈环，用户滚动可重新接管。
- `PageScheduler` 去重、并发上限 2、当前页优先并按页距排序；支持当前页和失败页重试。
- `translatePage` 只发送可翻译块，复用 OpenAI 严格 ID 往返校验；401/403 不重试，429/5xx 最多三次指数退避，退避期间取消立即生效。
- 后台 `PdfWorkspaceService` 持有 MinerU/OpenAI 凭据，负责公共 URL 解析、文档持久化、逐页缓存翻译、取消和单篇缓存清理。内容脚本消息、DOM 和错误响应不包含 Token/API Key 或 Provider 原始正文。
- Popup 对可识别 PDF 显示“翻译此 PDF/关闭 PDF 工作台”，与普通网页翻译入口互斥；探针继续作为开发诊断保留。

### TDD 记录

1. 消息、同步、生命周期与调度
   - RED：4 个测试文件因模块不存在失败。
   - GREEN：4 个文件、15 个测试通过。
2. PDF 源与逐页翻译
   - RED：2 个测试文件因模块不存在失败。
   - GREEN：2 个文件、6 个测试通过。
3. 双栏组件与正式接管端口
   - RED：2 个测试文件因模块不存在失败。
   - GREEN：2 个文件、4 个测试通过。
4. 后台服务与 Popup
   - RED：Popup/服务模块不存在，`pdf:parse-start` 缺少 `pageCount` 精确契约。
   - GREEN：3 个文件、13 个测试通过。IndexedDB 测试显式使用 `fake-indexeddb/auto`。

### 最终验证

- 新增与受影响定向测试：14 个文件、49 个测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，WXT Chrome MV3 生产构建生成 `/content-scripts/pdf-workspace.js`。
- 关闭恢复路径追加 TDD：接管端口测试先因未调用 `tabs.reload` 失败，修复后 2/2 通过；该生产改动使前次构建证据失效，因此重新运行 typecheck 与 build，均通过。
- 未运行全量 `npm run check` 或 E2E。

### 权限与隐私自查

- `entrypoints/pdf-workspace.content/index.tsx` 使用 `registration: 'runtime'` 且省略 `matches`。
- 构建 manifest 的 `content_scripts` 为空，没有静态 `host_permissions`；保留项目既有 `optional_host_permissions`。
- 正式启用仅由 Popup 消息触发后台 `activeTab` 动态注入。
- Provider 客户端只在后台构造；内容脚本只交换 PDF 字节、hash、文档模型和逐页译文。
- PDF 错误响应只返回结构化安全码，不返回 Provider 原始正文或凭据。

### 后续边界与已知 Minor

- 智能体、任务恢复、浏览器重启恢复和认证上传明确同意编排属于后续顺序批次。
- 本批次不做任务 8 的真实 Chrome 人工矩阵或 E2E，正式 action Popup、activeTab、原生权限弹窗仍需后续人工验收。
- KaTeX 与 PDF.js 使 runtime bundle/CSS 较大；当前优先保证离线渲染能力，后续可评估资源拆分，但不影响本批次正确性。

## 第二顺序批次：论文智能体、同意门禁与任务恢复

### 实现摘要

- 新增整篇论文上下文构建器。预算充足时按 `[p:N]` 包含整篇；超限时明确返回中文 compressed notice，并包含所有页摘要、当前页全文和用户选中文本。
- 新增后台 OpenAI 论文问答客户端，Prompt 限定仅依据论文回答、事实必须带 `[p:N]` 且不得编造页码。HTTP、网络和响应格式错误只暴露结构化安全码。
- 新增可收起 `AgentPanel`。对话状态保存在工作台父组件，收起/展开不丢失；支持发送、停止、错误、压缩提示。仅文档范围内引用转换为可访问页码按钮，点击同时定位左右栏。
- 认证 PDF 在 UI 展示 MinerU、文件名、大小和第三方传输说明；只有点击“同意并上传到 MinerU”后才调用上传批任务。未同意时后台返回 `PDF_AUTH_UPLOAD_REQUIRES_CONSENT`，不创建上传任务。
- 公共 PDF URL 任务创建或轮询失败时只进行一次字节上传回退，支持取消，不会无界重复上传。
- MinerU task 创建后立即写入 IndexedDB。数据库版本升级至 2，旧 store 保持兼容；任务新增可选 `errorCode`、`updatedAt`，无需重写旧记录。
- Service Worker 启动调用 `resumePending()`，恢复 `parsing` 任务并按内部 task id 去重；成功写入 document 并标记 done，失败只保存安全错误码。
- 工作台补充解析重试、失败页重试、停止/取消、清理单篇缓存、设置入口与 `aria-live` 状态。缓存清理同步重置 React 文档、译文和状态。

### TDD 记录

1. Agent context 与 consent/recovery
   - RED：context 模块不存在；consent=true 仍拒绝；公共 URL 不回退上传；`resumePending()` 不存在。
   - GREEN：agent context、workspace service、storage 共 3 个文件、11 个测试通过。
2. Agent client、Panel 与消息
   - RED：客户端和 Panel 模块不存在，`pdf:agent-ask` 未被精确消息校验接受。
   - GREEN：3 个文件、12 个测试通过。
3. 后台问答接线
   - RED：agent 请求误入逐页翻译分支并返回 `PDF_PAGE_MISSING`。
   - GREEN：workspace service 问答接线 6/6 通过。
4. URL 创建失败回退
   - RED：`createUrlTask()` 抛错直接向上泄出，未进入上传回退。
   - GREEN：workspace service 7/7 通过，创建失败与轮询失败均只回退一次。

### 最终验证

- 第二批新增与受影响定向测试：16 个文件、65 个测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，WXT Chrome MV3 构建完成。
- manifest 保持 `content_scripts: []`，无静态 `host_permissions`；未新增 `file://` 支持。
- 未运行全量 `npm run check` 或 E2E。

### 隐私与后续边界

- MinerU/OpenAI 设置、Authorization 与 Provider 请求只存在于后台；内容脚本不构造 Provider 客户端。
- 错误响应、DOM、日志和本报告不包含 API Key、Token、Provider 原始正文或论文全文。
- 本批完成后暂不进行独立复核；真实 Chrome action Popup、activeTab、认证 PDF 同意交互与任务 8 E2E/人工矩阵仍由后续统一验收负责。
