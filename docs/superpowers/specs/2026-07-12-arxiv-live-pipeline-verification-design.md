# arXiv 论文离线界面外在线全链路验收设计

## 背景

Chrome 原生 PDF 页面和扩展弹窗存在自动化边界，当前浏览器控制无法稳定读取扩展注入后的工作台 DOM。这不应阻塞 MinerU、结果下载、文档规范化和 LLM 翻译数据链路的真实验证。

本验收以 `https://arxiv.org/pdf/1706.03762` 为固定样本，在浏览器界面之外运行显式授权的在线集成测试。测试直接复用生产模块，不复制 MinerU 或 LLM 协议实现。

## 目标

- 使用生产 `loadPdfSource` 下载并校验 arXiv PDF，计算哈希。
- 使用 PDF.js 读取真实页数。
- 使用生产 `MineruClient` 创建公共 URL 解析任务并轮询结果。
- 使用生产 `loadMineruResult` 下载官方结果 ZIP 并规范化为逐页文档模型。
- 使用生产 `OpenAiTranslationClient`、`translatePage` 和并发数 2，从第 1 页开始翻译整篇论文。
- 输出不含敏感数据的阶段报告，明确页数、块数、完成页数、失败页数和各阶段耗时。

## 非目标

- 本验收不覆盖 Chrome 工具栏弹窗、原生 PDF 接管和视觉布局。
- 本验收不把 PDF 字节上传到 MinerU；arXiv 为公共 URL，使用 URL 任务。
- 本验收不保存论文正文、完整译文、API 响应正文或 Provider 凭证。
- 本验收不加入普通 `npm test`，避免无意产生真实请求、费用和长时间等待。

## 方案

### 独立授权测试入口

新增独立 Vitest 配置和 `test:live:arxiv` 命令。普通 Vitest 配置明确排除在线验收目录；只有显式运行该命令时才执行真实网络调用。

在线测试整体允许较长超时，并使用单独的总流程 `AbortController` 防止无限等待。MinerU 仍使用生产退避轮询；翻译仍使用生产重试和流式空闲超时。

### 凭据文件

LLM 继续读取已有且被 Git 忽略的：

`web-translate-plugin/.llm-experiment.local.json`

MinerU 新增本地文件：

`web-translate-plugin/.mineru-experiment.local.json`

结构为：

```json
{
  "baseUrl": "https://mineru.net",
  "token": "",
  "modelVersion": "vlm"
}
```

该文件精确加入根目录 `.gitignore`。仓库只提交不含真实 Token 的 `.mineru-experiment.example.json`。

配置加载器只接受 HTTPS 根地址、非空 Token、`vlm` 或 `pipeline` 模型版本；错误信息只指出字段问题，不包含字段值。

### 数据流

1. `loadPdfSource` 下载 `1706.03762`，验证 `%PDF-` 签名并得到 SHA-256 哈希。
2. PDF.js 从字节读取 `numPages`，供 MinerU 规范化元数据使用。
3. `MineruClient.createUrlTask` 把 arXiv 公共 URL 提交给 MinerU。
4. `MineruClient.waitForResult` 轮询到完成状态，取得官方 `full_zip_url`。
5. `loadMineruResult` 校验官方 CDN Origin、下载并解压 ZIP、读取唯一 `_content_list.json`，生成 `DocumentModel`。
6. `PageScheduler(pageCount, 2)` 按 1、2、3……顺序调度页面。
7. 每页通过 `translatePage` 调用流式 `OpenAiTranslationClient`，完整 JSON 校验成功后记为完成；失败保留页码和脱敏错误码。
8. 所有页面结束后输出汇总；失败页数大于 0 时测试失败。

## 报告与安全

控制台只允许输出：

- 样本论文 ID 和固定公开 URL；
- PDF 字节数、页数与 MinerU 文档块数；
- MinerU 创建、轮询、结果加载和逐页翻译耗时；
- 每页完成状态、翻译块数和耗时；
- 失败页码、稳定错误码和错误类别。

禁止输出：

- Authorization 请求头、API Key、MinerU Token；
- MinerU 任务完整响应、带签名的上传 URL 或结果 URL；
- PDF 正文、MinerU 内容列表、LLM 原始输出和完整译文。

本地凭据文件必须显示为 Git 忽略状态，任何提交命令均不得包含该文件。

## 错误处理

- PDF 下载、签名、PDF.js 页数读取、MinerU 创建、轮询、结果 ZIP 和 LLM 翻译分别记录阶段名与稳定错误码。
- MinerU 返回 `failed` 时报告 `MINERU_TASK_FAILED`，不继续翻译。
- 单页翻译使用生产重试策略；最终仍失败时记录 `PageTranslationError.failure` 的脱敏字段。
- 任一阶段失败时立即保留已有汇总并让在线测试失败。
- 总流程达到上限时主动取消，避免后台继续产生请求。

## 测试与验收

- 配置加载和报告脱敏使用无网络单元测试覆盖。
- 普通 `npm test` 必须证明在线目录未被执行。
- 显式运行 `npm run test:live:arxiv` 后：
  - PDF 下载和签名校验成功；
  - PDF.js 页数大于 0；
  - MinerU 返回有效文档，文档页数等于 PDF 页数且可翻译块数大于 0；
  - 全部页面完成翻译，失败页数为 0；
  - 输出中不包含凭据和论文正文。

在线验收成功只能证明数据全链路可用。Chrome PDF 接管和页面视觉仍需单独的浏览器验收结果。
