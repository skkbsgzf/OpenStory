# 建库域

建库工具把空目录变成可写的 OpenStory 库，或把已扫描的旧稿按计划导入目标库。`root` 是目标库根目录；`path` 是建库时作者给定的绝对路径；`sourcePath` 是外部旧稿目录的绝对路径。诊断与扫描只读，不触发旧库升级。

## 工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_library_create` | `path,name` | 在绝对路径创建库、写项目标记并登记到本机库列表；`primaryCarrier` 可选 | create |
| `openstory_library_diagnose` | `root` | 只读返回 `shape/verdict`，判断目录、项目标记与版本形状；不写盘、不升级 | read |
| `openstory_library_scan` | `root,sourcePath` | 扫描外部旧稿并返回导入 `plan`；零写入 | read |
| `openstory_library_import` | `root,sourcePath` | 按扫描计划导入旧稿，搬文件、留 `.history` 备份并写日志 | create |
| `openstory_library_primary` | `root,primaryCarrier` | 切换正文/剧本等主载体并更新项目标记；`expectedRevision` 可做乐观锁 | create |

## 空目录建库

```text
1. openstory_library_diagnose {root}       → 确认当前形状与 verdict
2. openstory_library_create {path,name,primaryCarrier?,confirm:"create"}
3. openstory_library_diagnose {root}       → 回读确认
4. openstory_libraries                     → 确认已登记并取正式 root
```

`path` 必须可写；不存在的目录会被创建。`primaryCarrier` 省略时使用库类型默认值。建库后会写 `.openstory/project.json` 并登记本机库，因此不能把它当无副作用的试运行。

## 旧稿导入

```text
1. openstory_library_scan {root,sourcePath}
2. 检查 plan：将搬什么、跳过什么、冲突什么
3. openstory_library_import {root,sourcePath,confirm:"create"}
4. openstory_files {root} 与相关读工具逐项回读
```

先 scan 再 import，不跳过计划直接搬。导入有备份与日志，但仍会改变目标库内容，必须取得 create 级确认。

## 主载体与版本保护

`openstory_library_primary` 修改项目标记，不是重命名文件。传入当前 `project.json` 的 `revision` 作为 `expectedRevision` 可避免覆盖并发修改；版本不符时拒绝写入。切换后用 `openstory_library_diagnose` 和 `openstory_plugins` 回读项目与模块投影。

## 升级确认链（OS-222/223）

操作说明书见 `openstory_skills_read {name:"update-project"}`（仓 `skills/update-project/SKILL.md`＋速查表）。旧库一次性升级与能力迁移改走「诊断 → 计划 → 作者确认 → 执行 → 核对」的闭环，导入工具不替代它：

```text
1. openstory_upgrade_diagnose {root}           # 只读诊断；零写入
2. openstory_upgrade_plan {root}               # 只读计划，产出 planId（绑定文件/迁移器摘要）
3. openstory_upgrade_apply {root,planId,confirm:"migrate"}  # 显式动稿；必须 migrate 级确认
4. openstory_upgrade_status {root}             # 只读：journal/dataVersions/回滚状态
5. openstory_upgrade_backup_verify {root,backup?} # 只读：逐文件哈希核对备份
```

- `openstory_upgrade_diagnose` / `openstory_upgrade_plan` / `openstory_upgrade_status` / `openstory_upgrade_backup_verify` 都是只读，无需确认；预览前后整库字节不变。
- `openstory_upgrade_apply` 必须带有效 `planId` 且满足 `migrate` 级确认。服务端复核 root、文件哈希与迁移器摘要；预览后文件一变 planId 即失效，须重新出计划。确认参数 `confirm:'migrate'` 不能被布尔业务参数替代。
- 执行复用现有 journal/备份/原子写/回滚；失败如实报 `rolledBack`/`rollbackErrors`，不自动重试。`DATA_VERSION_AHEAD` 在计划/状态里如实呈现，不静默改写。
- 结果含 `journals` 与 `backups` 相对路径供核对；区分成功、幂等、冲突、已回滚与回滚未完成。

## 边界

- `openstory_library_diagnose` 与 `openstory_library_scan` 只诊断/产计划，不执行旧库升级。
- 旧库升级/迁移不得用 shell/fs 改稿或复制备份覆盖；只走上面的确认链。
- 建库后继续用 `openstory_suites` 配置写作/编剧套件，用 `openstory_plugins` 检查模块与能力图。
