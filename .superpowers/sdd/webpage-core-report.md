# 普通网页翻译核心域实施报告

## 状态

DONE

## 提交

- 提交信息：`feat: add webpage translation core domain`
- 本报告与实现、测试包含在同一提交中；提交哈希由提交完成后的 Git 记录确定。

## 完成范围

- 在 `src/settings/schema.ts` 与 `src/settings/store.ts` 中实现仅使用 `chrome.storage.local` 的设置模型、默认 `en` 到 `zh-CN` 语言和读写接口。
- 在 `src/providers/openai/` 中实现 `/chat/completions`、JSON Object 响应、block id 映射、AbortSignal 透传及严格响应校验。
- 在 `src/webpage/` 中实现页面资格判断、稳定文本块扫描、视口优先队列和只修改 `Text.data` 的翻译控制器。
- 未修改 Popup、内容脚本、background 或 PDF 探针。

## RED → GREEN 证据

### RED

1. `npm test -- tests/unit/webpage-translation/provider.test.ts`
   - 结果：失败；无法解析尚不存在的 `settings` 与 `openai-client` 模块。
2. `npm test -- tests/unit/webpage-translation/page-analysis.test.ts`
   - 结果：失败；无法解析尚不存在的 `scan-text` 与 `eligibility` 模块。
3. `npm test -- tests/unit/webpage/viewport-queue.test.ts tests/unit/webpage/translation-controller.test.ts`
   - 结果：失败；无法解析尚不存在的队列与控制器模块。
4. `npm test -- tests/unit/webpage/eligibility.test.ts tests/unit/webpage/scan-text.test.ts tests/unit/webpage/translation-controller.test.ts`
   - 结果：失败；暴露密码路径误放行、损坏 URL 编码抛异常及 `TextBlock.original` 契约缺失。
5. `npm test -- tests/unit/webpage/scan-text.test.ts`
   - 结果：失败；暴露重复扫描时原文被已变化文本覆盖的问题。

### GREEN

最终定向命令：

```text
npm test -- tests/unit/settings/store.test.ts tests/unit/providers/openai/client.test.ts tests/unit/webpage/eligibility.test.ts tests/unit/webpage/scan-text.test.ts tests/unit/webpage/viewport-queue.test.ts tests/unit/webpage/translation-controller.test.ts
```

结果：exit 0；6 个测试文件、24 项测试全部通过。

完整检查命令：`npm run check`

结果：exit 0；TypeScript 检查通过，13 个测试文件、61 项测试全部通过，Chrome MV3 生产构建成功。

## 自查

- API Key 泄露：API Key 仅存在于 local 设置对象及请求 `Authorization` 头；生产代码未写入 DOM、日志或诊断输出。
- 父元素替换：扫描器为只读；控制器只修改保留引用的 `Text.data`，未使用 `innerHTML`、`replaceWith` 或 `replaceChild`，测试验证父元素和属性保持不变。
- 静态 Host 权限：未修改 `wxt.config.ts`；没有新增静态 `host_permissions`，既有可选权限保持不变。
- PDF 回归：未修改 `src/pdf-takeover/`、PDF 内容脚本或后台入口；完整测试包含既有 PDF 单元测试且全部通过。
- 越界范围：未修改 Popup、内容脚本和 background。

## 关注点

- 无阻塞关注点。Provider 真实网络调用和浏览器消息接线按简报明确不属于本里程碑范围。
