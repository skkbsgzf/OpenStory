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

## 边界

- `openstory_library_diagnose` 与 `openstory_library_scan` 只诊断/产计划，不执行旧库升级。
- 旧库一次性升级是显式动稿操作，只走 OpenStory 界面；不要用 MCP 导入工具绕过升级。
- 建库后继续用 `openstory_suites` 配置写作/编剧套件，用 `openstory_plugins` 检查模块与能力图。
