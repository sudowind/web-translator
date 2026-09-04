# release 集成与人工验收流程

## 工作区职责

- 开发主线：`D:\Projects\web-translate`，分支 `dev`。
- 人工验收：`D:\Projects\web-translate-worktrees\release`，分支 `release`。
- 功能缺陷回到对应开发分支修复、测试、提交；release 只处理集成冲突和跨分支兼容问题。
- 原开发工作区保持独立，不将 release 整体合回功能分支。
- 本轮只做本地提交与合并，不自动推送或合入 master。

## 首次加载验收插件

1. 在 Chrome 扩展管理页停用 dev 版本，先不要卸载，以保留原有配置与数据。
2. 开启开发者模式，选择“加载已解压的扩展程序”，选择以下目录：

   `D:\Projects\web-translate-worktrees\release\web-translate-plugin\.output\chrome-mv3`

3. 在插件详情确认加载路径，并记录 release 扩展 ID；两版名称相同，不能仅凭名称区分。
4. 当前 manifest 没有固定 key，新路径可能对应独立扩展 ID。不要假定配置、授权、历史和缓存自动共享；在 release 中手工配置 Provider 和所需权限，不把密钥写入 Git 或验收报告。
5. 刷新待测试网页或 PDF，再使用 release 的工具栏按钮启动功能。

加载与重载方式参见 [Chrome 官方扩展入门](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)。卸载会清除扩展 local 存储，参见 [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)。

## 后续每轮集成

先在对应开发工作区提交修复，确保要纳入的内容已形成提交。再进入 release 工作区：

```powershell
Set-Location D:\Projects\web-translate-worktrees\release
git status --short --branch
git merge --no-ff <对应开发分支>
```

若出现冲突，逐处保留两边所需行为，在 release 解决、暂存并提交；不要直接以整分支覆盖另一侧。完成后执行：

```powershell
Set-Location D:\Projects\web-translate-worktrees\release\web-translate-plugin
# 仅当锁文件改变或首次安装时执行
npm ci --no-audit --no-fund
npm run check
npm run test:e2e
git rev-parse HEAD
```

`check` 包含类型检查、单元测试、生产构建与产物安全检查。将该提交号及命令结果记录为本轮验收基线。人工验收期间不再合入新提交；需要更新时明确开启下一轮验收。

后续更新无需反复安装：在扩展管理页对 release 点击“重新加载”，随后刷新被测网页或 PDF。仅重新加载 dev 扩展不会切换到 release。

## 本轮人工验收清单

- 控制台：最近阅读、AI 服务、翻译偏好、PDF 解析、存储与隐私分区可用。
- 翻译设置：自动、严格 Schema、JSON 模式可选；能力测试时禁用编辑，结束后结果可读。
- 真实 Provider：在用户自行配置的接口上测试；此操作可能计费，自动模式最多两次最小探测。
- PDF：浅色、深色、跟随系统切换及刷新后的偏好持久化正常。
- arXiv：已解析论文重新打开可恢复，分页与翻译进度正常。
- 历史：网页和 PDF 阅读记录可再次打开；删除历史与清理缓存的行为符合界面说明。
- 原生权限弹窗、真实 action Popup、activeTab 授权由用户手动验证；自动化授权路径不替代这些门禁。

## 数据版本注意事项

本轮 release 使用 IndexedDB v5，集成 dev 的 v3 源缓存与 Dashboard 独立 v4 历史库，并兼容从这两种结构升级。采用独立扩展安装可隔离验收数据。

不要把旧分支构建覆盖到已经运行 release 的同一扩展 ID / 浏览器数据环境：旧分支仍使用较低数据库版本，不能直接降级打开 v5。回测旧版应使用原来的独立扩展或独立浏览器配置，不通过清空用户数据规避版本问题。
