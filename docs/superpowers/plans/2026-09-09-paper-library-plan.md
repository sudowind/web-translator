# 论文库首版实施计划

1. 从 origin/master 0878ca1 建立 codex/paper-library，工作区 D:\Projects\web-translate\.superpowers\worktrees\paper-library。主目录保持 release（起始 c9fff03），不回灌 release。
2. 实现 v6 存储迁移、收藏与目录事务、受限后台消息，补定向逻辑与安全测试。
3. 实现共享收藏编辑面板、PDF 星标、最近阅读入口、控制台文件夹树与列表，补组件和真实扩展 E2E。
4. 开发工作区运行定向测试、类型检查及构建；安排一次独立只读复核，集中修复并由同一 reviewer 确认。
5. 普通 merge 到 release，完成集成后在当前候选运行 npm run check 和相关 E2E 一次，记录 SHA、结果、耗时与人工门禁。人工验收前不推送、不发布、不清理工作区。
