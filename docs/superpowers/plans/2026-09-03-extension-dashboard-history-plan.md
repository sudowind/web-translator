# 扩展独立控制台与翻译历史实施计划

日期：2026-09-03  
状态：已完成

## 1. 入口与控制台外壳

- 在 `web-translate-plugin/entrypoints/options/index.html` 声明 WXT 独立标签页选项。
- 重构 options 页面，建立最近阅读、AI 服务、翻译偏好、PDF 解析、存储隐私五个分区。
- 更新 Popup 文案为“打开控制台”，保留 PDF 工作台设置入口。

## 2. 历史仓储

- 将数据库升级到版本 4，新增带时间和类型索引的 `history` store；集成时保留并行 arXiv 分支的 v3 迁移。
- 增加历史合并、最近列表、单条删除、清空和存储概览。
- 保持缓存清理与历史清理相互独立。

## 3. 网页与 PDF 历史采集

- 为普通网页翻译服务注入历史记录器，首批成功翻译后使用可信标签页元数据写入。
- 扩展 PDF 消息协议，增加历史访问和阅读进度更新；后台校验发送者和字段。
- PDF 工作台在源就绪及活动页变化时节流上报。

## 4. 历史交互与设置安全

- 控制台支持搜索、类型筛选、重新打开、单条删除和清空。
- 存储页展示记录数量，并提供相互独立的清理动作。
- 设置测试发送者校验改为扩展 ID 与 options 路径校验，允许查询参数和 Fragment。

## 5. 验证门禁

1. 运行 storage、webpage、PDF message、settings/options 定向测试。
2. 运行 `npm run typecheck`。
3. 运行 `npm run build` 与 `npm run verify:output`。
4. 完成复核和必要修复后，只运行一次 `npm run check`。
