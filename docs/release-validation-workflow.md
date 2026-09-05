# release 集成与人工验收流程

## 工作区职责与周期状态

- 主工作区：`D:\Projects\web-translate`。空闲或上一轮发布完成后检出 `master`；一轮集成与人工验收期间检出 `release`。
- 主工作区也是固定的浏览器插件加载入口。验收期间不得切到开发分支；PR 合并前也不得提前把尚未验收的 release 当作 master。
- 每项新需求原则上从最新 `master` 创建独立 feature 分支和 worktree。`D:\Projects\web-translate-worktrees\dev` 只承接明确归属于 `dev` 的任务，不再作为所有 feature 的默认基线。
- 功能缺陷回到对应开发分支修复、测试、提交；release 只处理集成冲突和跨分支兼容问题。
- 原开发工作区保持独立，不将 release 整体合回功能分支。
- 推送 release、创建或合并 PR、删除 worktree 或分支分别按用户授权执行，不能由进入某个阶段自动推导授权。

## 原安装直接升级为验收插件

1. 原来从主工作区安装的插件继续使用，无需卸载或重新安装。无论主工作区当前处于 master 还是 release，生产构建输出始终在原路径：

   `D:\Projects\web-translate\web-translate-plugin\.output\chrome-mv3`

2. 关闭旧插件设置页及正在运行的翻译工作台，在 Chrome 扩展管理页对原插件点击“重新加载”。原加载路径和扩展身份不变，本地 Provider 配置及数据继续使用；不要清空存储或把密钥写入 Git。
3. 进入验收阶段后先确认主工作区为 release 并完成生产构建，再刷新待测试网页或 PDF。此时运行的是本轮 release 候选；空闲阶段在 master 构建时则运行稳定版本。
4. 如果此前额外安装过独立 release 目录版本，停用该副本以免两版干扰；原独立 release 目录已迁移为 dev 工作区，旧安装路径不再有效，Chrome 不会自动跟随 Git 工作区移动。不要依赖该副本自动共享原插件配置。
5. 只有从未安装过主目录插件时，才需要“加载已解压的扩展程序”并选择上方固定目录。

加载与重载方式参见 [Chrome 官方扩展入门](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)。卸载会清除扩展 local 存储，参见 [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)。

## 开启新一轮开发

先确认上一轮 PR 已合入、远端检查通过且所有工作区没有归属不明的改动。主工作区在 master 更新稳定基线，然后让长期 release 分支快进到 master：

```powershell
Set-Location D:\Projects\web-translate
git switch master
git fetch origin
git merge --ff-only origin/master
git merge-base --is-ancestor release master
if ($LASTEXITCODE -ne 0) { throw 'release 仍有未进入 master 的提交，停止开启新一轮' }
git switch release
git merge --ff-only master
```

如果祖先检查失败，说明 release 仍有未进入 master 的提交，停止并核对，不能 reset 或强制移动分支。随后从最新 master 为每项需求创建独立 feature worktree，例如：

```powershell
git worktree add D:\Projects\web-translate-worktrees\<feature-name> -b codex/<feature-name> master
```

不要在同一 worktree 并行实现，也不要默认从陈旧 dev 分叉。

## 开发、集成与验收

先在对应开发工作区提交修复，确保要纳入的内容已形成提交。主工作区在整个集成与人工验收阶段保持 release：

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

后续更新无需反复安装或重新配置：开发工作区提交 → 主工作区的 release 合并 → 构建并验证 → 对原插件重新加载 → 刷新被测网页或 PDF。功能问题回到原 feature 修复，再增量合入 release。

## 验收通过与收尾

用户明确验收通过后，按授权推送 release 并创建 `release → master` PR。PR 合并且远端检查通过后：

```powershell
Set-Location D:\Projects\web-translate
git fetch origin
git switch master
git merge --ff-only origin/master
```

此时主工作区回到稳定阶段。release 分支保留，下一轮再快进到新 master。只有同时满足“提交已进入 master、worktree 干净、不再需要返工”的 feature 才建议清理；实际删除 worktree、本地分支或远端分支前再次核对目标并取得用户明确授权。

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
