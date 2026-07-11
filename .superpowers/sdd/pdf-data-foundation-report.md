# PDF 工作台数据基础里程碑实施报告

## 状态

已完成文档模型与 MinerU 规范化、MinerU 单任务与上传批任务客户端、结果 Zip 加载、MinerU 扩展设置、IndexedDB 文档/译文/任务/阅读状态仓储。本里程碑未实现 PDF React 工作台，未修改 PDF 接管行为或普通网页翻译运行时。

## 实现摘要

- 新增 `DocumentModel`、`DocumentPage`、`DocumentBlock`、稳定页 ID/块 ID 与不可信 MinerU JSON 规范化。
- 规范化保留空白页、页序、页内顺序、公式 LaTeX、表格 HTML/文本、图片路径、caption 与 bbox/polygon；错误使用不包含输入原文的结构化代码。
- 新增 `MineruClient.createUrlTask()`、`createUploadTask()`、`waitForResult()`；严格区分 single/batch 查询端点，批结果按 `data_id` 选择。
- 轮询支持有限次数、可注入 sleep、指数退避上限与 `AbortSignal`；原生 fetch 以无绑定局部函数调用。
- Zip 加载允许 `_content_list.json` 带目录前缀，并覆盖缺失、重复、损坏 Zip、非数组 JSON、HTTP/网络失败。
- `ExtensionSettings` 新增默认 MinerU 配置。Token 为空时不影响 OpenAI 设置，也不请求 MinerU Origin；Token 非空时校验 HTTPS、模型版本，并在设置页保存/测试的真实用户手势中与 OpenAI Origin 一并请求精确权限。
- 旧本地设置读取时自动补齐 MinerU 默认值；Provider 测试消息仍保持扩展设置页专用和精确键校验。
- 新增四个 IndexedDB store 及仓储。译文缓存键使用 JSON 元组编码，覆盖 hash/page/source/target/provider/model/schema，避免分隔符碰撞；任务保存判别联合 `providerTask` 并支持按状态恢复。
- 单篇清理覆盖 document、translation、task、reading，全量清理覆盖全部 store。
- 保留控制器已安装的依赖变更，未升级 `pdfjs-dist`；已删除 `.npm-cache/`。

## TDD 记录

1. 文档规范化
   - RED：`npm test -- tests/unit/document/normalize-mineru.test.ts`，因 `src/document/normalize-mineru` 不存在失败。
   - GREEN：同命令通过，1 个文件、8 个测试。
2. MinerU Provider 与 Zip
   - RED：`npm test -- tests/unit/providers/mineru/client.test.ts tests/unit/providers/mineru/result-loader.test.ts`，因两个模块不存在失败。
   - GREEN：同命令通过，2 个文件、11 个测试。
3. 设置与权限
   - RED：`provider-access.test.ts` 与 `store.test.ts` 共 6 个断言因 MinerU 配置、Origin 和迁移行为缺失失败。
   - GREEN：同组 2 个文件、7 个测试通过。
   - RED：`test-provider.test.ts` 因严格消息键尚未接受 `mineru`，2 个测试失败。
   - GREEN：与普通网页翻译回归合并运行，2 个文件、10 个测试通过。
4. IndexedDB 仓储
   - RED：`repositories.test.ts` 因仓储模块不存在失败。
   - GREEN：同命令通过，1 个文件、4 个测试。

## 最终验证

- 定向测试：8 个文件、40 个测试全部通过。
- 类型检查：`npm run typecheck` 通过。
- 必要构建：`npm run build` 通过，WXT Chrome MV3 生产构建完成。
- 按简报未运行全量 `npm run check` 或 E2E。

## 边界与安全自查

- MinerU URL 单任务使用 `/api/v4/extract/task`；上传批任务使用 `/api/v4/file-urls/batch` 与 `/api/v4/extract-results/batch/{batch_id}`。
- batch 引用强制包含 `dataId`，查询不把 `batch_id` 传给单任务端点，也不默认选择批结果第一项。
- Token、响应正文和不可信 MinerU 全文不进入错误详情或日志；没有新增内容脚本凭据消息。
- 没有修改 PDF 探针、接管入口、普通网页内容脚本或普通网页翻译运行时代码。
- 没有新增静态 Host 权限，`pdfjs-dist` 版本保持 `^6.1.200`。

## 关注点

- 当前仅交付数据基础；任务恢复的 Service Worker 编排、PDF 工作台 UI 和真实浏览器权限交互验收属于后续产品里程碑。
- MinerU 远端真实响应仍需后续集成验收；本里程碑使用官方协议形状的定向测试覆盖 single/batch 分流和错误边界。

## 唯一修复波

根据数据基础里程碑复核意见，追加完成以下加固：

- 将官方 `running` 在 single 与 batch 任务中统一规范化为内部运行状态并继续轮询。
- 轮询退避改为可感知 `AbortSignal` 的 sleep race；取消后不等待完整退避时间，并在完成、失败或取消时移除 abort listener。
- metadata 的 `pageCount` 限制为 safe integer 且范围为 1..600；`sourceUrl`、`hash`、`title` 修剪后必须非空，稳定 ID 使用修剪后的 hash；raw block `type` 修剪后必须非空。
- `MineruSettings` 只在 `src/providers/mineru/contracts.ts` 定义，设置 schema 通过 type-only import 与 re-export 使用，未增加运行时循环。

### 修复波 TDD 记录

- RED：client/normalize 两个文件共 11 个新增断言失败；single/batch `running` 返回 `MINERU_STATE_INVALID`，退避中 abort 测试超时，metadata 边界与修剪断言失败。
- GREEN：client、normalize 与 settings 相关 5 个定向测试文件共 38 个测试通过。
