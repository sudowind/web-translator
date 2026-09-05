# release 集成与人工验收流程

## 工作区职责

- 人工验收主工作区：`D:\Projects\web-translate`，固定分支 `release`。
- 开发主线工作区：`D:\Projects\web-translate-worktrees\dev`，分支 `dev`。
- 功能缺陷回到对应开发分支修复、测试、提交；release 只处理集成冲突和跨分支兼容问题。
- 原开发工作区保持独立，不将 release 整体合回功能分支。
- 本轮只做本地提交与合并，不自动推送或合入 master。

## 原安装直接升级为验收插件

1. 原来从主工作区安装的插件继续使用，无需卸载或重新安装。主目录已从 dev 切换为 release，生产构建输出仍在原路径：

   `D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3`

2. 关闭旧插件设置页及正在运行的翻译工作台，在 Chrome 扩展管理页对原插件点击“重新加载”。原加载路径和扩展身份不变，本地 Provider 配置及数据继续使用；不要清空存储或把密钥写入 Git。
3. 刷新待测试网页或 PDF，再使用原来的工具栏按钮启动功能。此时运行的是 release 构建。
4. 如果此前额外安装过独立 release 目录版本，停用该副本以免两版干扰；原独立 release 目录已迁移为 dev 工作区，旧安装路径不再有效，Chrome 不会自动跟随 Git 工作区移动。不要依赖该副本自动共享原插件配置。
5. 只有从未安装过主目录插件时，才需要“加载已解压的扩展程序”并选择上方固定目录。

加载与重载方式参见 [Chrome 官方扩展入门](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)。卸载会清除扩展 local 存储，参见 [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)。

## 后续每轮集成

先在对应开发工作区提交修复，确保要纳入的内容已形成提交。再进入 release 工作区：

```powershell
Set-Location D:\Projects\web-translate
git status --short --branch
git merge --no-ff <对应开发分支>
```

若出现冲突，逐处保留两边所需行为，在 release 解决、暂存并提交；不要直接以整分支覆盖另一侧。完成后执行：

```powershell
Set-Location D:\Projects\web-translate\web-translate-plugin
# 仅当锁文件改变或首次安装时执行
npm ci --no-audit --no-fund
npm run check
npm run test:e2e
git rev-parse HEAD
```

`check` 包含类型检查、单元测试、生产构建与产物安全检查。将该提交号及命令结果记录为本轮验收基线。人工验收期间不再合入新提交；需要更新时明确开启下一轮验收。

后续更新无需反复安装或重新配置：开发工作区提交 → 主工作区 merge → 构建并验证 → 对原插件重新加载 → 刷新被测网页或 PDF。主目录长期保持 release，不使用切换分支来切换验收版本。

## 本轮人工验收清单

- 控制台：最近阅读、AI 服务、翻译偏好、PDF 解析、存储与隐私分区可用。
- 翻译设置：自动、严格 Schema、JSON 模式可选；能力测试时禁用编辑，结束后结果可读。
- 真实 Provider：在用户自行配置的接口上测试；此操作可能计费，自动模式最多两次最小探测。
- PDF：浅色、深色、跟随系统切换及刷新后的偏好持久化正常。
- arXiv：已解析论文重新打开可恢复，分页与翻译进度正常。
- 历史：网页和 PDF 阅读记录可再次打开；删除历史与清理缓存的行为符合界面说明。
- 原生权限弹窗、真实 action Popup、activeTab 授权由用户手动验证；自动化授权路径不替代这些门禁。

## 数据版本注意事项

本轮 release 使用 IndexedDB v5，集成 dev 的 v3 源缓存与 Dashboard 独立 v4 历史库，并兼容从这两种结构升级。原插件首次加载 release 后会升级数据库；此前迁移回归验证了原缓存和历史数据保留。

不要把旧分支构建覆盖到已经运行 release 的同一扩展 ID / 浏览器数据环境：旧分支仍使用较低数据库版本，不能直接降级打开 v5。回测旧版应使用开发工作区的独立扩展或独立浏览器配置，不通过清空用户数据规避版本问题。
