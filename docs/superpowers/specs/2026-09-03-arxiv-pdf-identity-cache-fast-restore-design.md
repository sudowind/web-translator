# arXiv PDF 标识缓存与快速恢复设计

日期：2026-09-03  
状态：已实现并通过完整验证（2026-09-04）

## 1. 背景

当前 PDF 工作台每次接管页面后都会完整读取 PDF、绕过 HTTP 缓存并计算 SHA-256，随后才能查询 MinerU 文档模型和逐页译文缓存。对于几十 MiB 的 arXiv 论文，即使解析与译文已经缓存，二次打开仍被整文件网络读取、哈希和 PDF.js 初始化阻塞。

arXiv 论文具有可从 URL 提取的稳定论文标识。显式版本 URL（例如 `2510.12403v2`）可视为不可变文档；不带版本号的 URL 表示该论文的最新版，需要在复用缓存时进行轻量版本校验。

## 2. 目标

1. arXiv 页面在下载 PDF 正文前即可定位文档模型和译文缓存。
2. 缓存命中时先恢复译文阅读界面，PDF 原文独立加载，不再阻塞右栏。
3. PDF.js 对 arXiv 使用 URL 输入，允许浏览器 HTTP 缓存、Range 和流式加载，不在 React 启动路径中强制持有完整字节。
4. 显式 `vN` 进入缓存键；不带版本号时用轻量 `HEAD` 校验响应修订信息，发现变化后清除旧解析和译文。
5. 非 arXiv、认证 PDF、MinerU URL 失败后的上传回退继续使用现有完整字节、SHA-256 和用户同意边界。
6. 保留现有缓存清理、逐页调度、Agent、页面锚点和 PDF Canvas 生命周期。

## 3. 非目标

- 不为所有网站建立 URL 即可信的缓存规则。
- 不把 PDF 原始字节长期写入 IndexedDB、Cache Storage 或 OPFS。
- 不依赖 arXiv HTML 页面结构或抓取正文来判断版本。
- 不改变 MinerU 或 OpenAI Provider 协议。
- 不在本次增加离线打开尚未被浏览器缓存的 PDF。

## 4. arXiv 文档身份

新增纯逻辑解析器，把 `/abs/2510.12403`、`/pdf/2510.12403` 和 `/pdf/2510.12403.pdf` 等价地址规范化。允许 `arxiv.org`、`www.arxiv.org`、`export.arxiv.org`；现代和旧式 arXiv 标识均保留，查询参数和页面锚点不进入缓存键。

规范键格式为：

- 无显式版本：`arxiv:2510.12403`
- 显式版本：`arxiv:2510.12403v2`
- 旧式标识：`arxiv:hep-th/9901001v1`

只接受明确的 arXiv 主机和 `/abs/`、`/pdf/` 路径；相似域名、额外路径和非法标识继续走通用 PDF 路径。

## 5. 缓存与版本校验

IndexedDB 升级到版本 3，新增 `sources` 存储，字段为 `id`、关联的 `hash`、规范 `sourceUrl`、可选 `revision` 与 `updatedAt`。同时为 documents 增加 `by-source-url` 索引，以便懒迁移升级前缓存。

缓存解析流程：

1. 内容脚本发送原始 `sourceUrl`；后台独立验证并规范化。
2. 后台先读取 `sources`，再读取关联 `DocumentModel`；新格式也允许直接以 arXiv 键读取。
3. 升级前缓存可按 `DocumentModel.sourceUrl` 索引找到并懒写入 `sources`；同源存在多个不同 hash 时保守视为未命中，不任意选择旧版本。
4. 显式版本直接复用缓存，不发版本校验请求。
5. 无显式版本在复用缓存前发送 `HEAD`，使用 `cache: no-cache`，不读取响应正文。修订优先使用 ETag，退化为 Last-Modified 与 Content-Length 组合。
6. 新旧修订都存在且不一致时，原子清除关联的文档、译文、任务、阅读记录和源映射，并返回缓存未命中。
7. 网络失败、两秒超时或服务器未提供有效修订头时保守复用已有缓存，不破坏可用数据。

缓存清理必须同步删除所有指向该文档 hash 的 `sources` 记录。arXiv 按来源 URL 清理，后台同时收集稳定身份键、已有别名指向的 hash 以及旧文档来源索引中的全部匹配 hash，覆盖首次懒迁移尚未写入别名的情况。每个 hash 的写入队列与代次屏障阻止清理后的旧请求回填数据库或内存缓存。

## 6. 启动与渲染流程

### 6.1 arXiv

1. 内容脚本同步识别 arXiv，立即建立轻量 `PdfSourceDescriptor`，不读取 PDF 正文。
2. 后台执行文档缓存解析和轻量版本校验。
3. PDF.js 同时以规范 PDF URL 启动，使用浏览器 HTTP 缓存、Range 和流式加载。
4. 缓存命中后设置 `DocumentModel`，一次读取译文快照并恢复右栏；此过程不等待 PDF.js 完成。
5. PDF.js 就绪后补齐真实页尺寸和 Canvas。缓存未命中时才启动 MinerU URL 解析。

### 6.2 非 arXiv

保持现有流程，但公共读取不再强制 `no-store`，允许浏览器按标准 HTTP 规则复用响应。完整读取与 SHA-256 仍是通用源的身份与上传回退保护。

### 6.3 认证与上传回退

认证 PDF 继续完整读取并要求明确同意后才能上传 MinerU。arXiv 的 MinerU URL 任务失败而转为上传时，后台才读取完整 PDF；该读取不发生在缓存命中启动路径。

## 7. 状态与交互

- 初始提示为“正在检查本地缓存；PDF 原文独立加载”。
- 命中后提示“已恢复解析缓存，正在恢复译文”。
- 未命中且 PDF.js 已就绪后才显示“MinerU 正在解析”。
- 左栏尚未取得页面代理时显示 PDF 页面骨架；右栏可以先显示缓存译文。
- 工具栏标题优先使用缓存模型标题，其次使用轻量 arXiv 文件名。
- arXiv 清除缓存以原始 `sourceUrl` 为入口，由后台解析所有关联键；非 arXiv 仍按 `model.hash` 或源 hash 清理。清理后公共 PDF 自动重新解析，认证 PDF 仍需明确同意。

## 8. 安全与正确性

- 消息继续执行精确字段校验；后台不得信任内容脚本提供的缓存键。
- `HEAD` 不携带凭据，只用于公开 arXiv；认证源不进入该路径。
- 不把 PDF 字节、响应正文或 Provider 密钥写入诊断信息。
- URL 只接受 HTTP(S)，规范化后固定到 `https://arxiv.org/pdf/<id>`。
- 数据库升级必须兼容既有 documents、translations、tasks、reading 数据。

## 9. 验收标准

- 同一 arXiv URL 的 `/abs/`、`/pdf/` 和 `.pdf` 形式命中同一缓存键。
- `v1` 与 `v2` 缓存互不污染；无版本 URL 使用独立 latest 键。
- 二次打开缓存查询路径不调用通用整文件读取或 SHA-256，不调用 MinerU；PDF.js 为显示原文而进行的独立读取不受此限制。
- 无版本 URL 只用 `HEAD` 校验；修订变化时旧译文不继续使用。
- 缓存译文可在 PDF.js `onDocumentReady` 之前恢复。
- PDF.js arXiv 输入为 URL；非 arXiv 输入仍为字节。
- 缓存清理同时删除源映射。
- 定向单元测试、`npm run check` 和 PDF 工作台 E2E 通过。
