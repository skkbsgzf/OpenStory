# OpenStory 本地 MCP · 总览（对外分发材料）

OpenStory 是跑在本机的小说工作台。MCP 当前对外提供 **65 个工具**：覆盖小说与剧本载体、世界书、习惯、故事源事实与富化、确定性推演、多角色扮演、多局会话、素材、建库与套件、升级确认链、导入导出、技能、分析和插件投影。工具名、参数与描述以 `src/host/mcp.mjs` 导出的 `MCP_TOOL_NAMES` 和运行时 `tools/list` 为唯一真源；本目录只讲能力边界与使用顺序。

## 连接

```json
{ "command": "node", "args": ["D:\\OpenStory\\src\\host\\mcp.mjs"] }
```

- 前置：OpenStory daemon 必须在本机运行（`npm start`，默认 `127.0.0.1:8807`；用 `OPENSTORY_PORT` 改端口）。
- 唯一例外：`openstory_analysis_chapter` 是纯本地计算，不依赖 daemon。
- stdio 协议：newline-delimited JSON-RPC 2.0；`initialize → tools/list → tools/call`。
- 先用 `openstory_libraries` 取得授权的库根 `root`。需要从空目录建库时先用 `openstory_library_diagnose`，再用 `openstory_library_create`。

## 模块与域分工

| 模块 / 域 | 工具与职责 | 详细说明 |
|---|---|---|
| 元信息 | `openstory_libraries`、`openstory_files`：取 root、看库内文件 | 见下 |
| 小说与章节 | `openstory_novel_list_chapters`、`openstory_novel_read_chapter`、`openstory_novel_write_chapter`、`openstory_novel_new_chapter`、`openstory_novel_delete_chapter`、`openstory_chapters_rename`：正文/剧本载体章节读写与保号重命名 | [novel.md](novel.md) |
| 世界书 | `openstory_reference_index`、`openstory_reference_graph`、`openstory_reference_read_note`、`openstory_reference_write_note`：创作型条目知识库、标签、双链与反链 | [reference.md](reference.md) |
| 习惯 | `openstory_habits_read`、`openstory_habits_put`：作者写作规矩，成文前必读必守 | 见下 |
| 视觉与生图 | `openstory_vision_describe`：为库内图片写文学白描；`openstory_image_generate`：为世界书条目生成设定图 | [assets.md](assets.md) |
| 故事源事实 | `openstory_fact_books`、`openstory_fact_entries`、`openstory_fact_entries_import`：事实书定位、条目读取与整份替换 | [fact.md](fact.md) |
| 富化与确定性推演 | `openstory_enrich_run`、`openstory_enrich_status`、`openstory_enrich_graph`、`openstory_fact_curve`、`openstory_deduce_present`、`openstory_deduce_settle`：派生知识图谱、章级曲线与种子化拍循环 | [deduce.md](deduce.md) |
| 多局与多角色扮演 | `openstory_sessions`、`openstory_session_get`、`openstory_session_new`、`openstory_session_switch`、`openstory_session_delete`、`openstory_session_put`、`openstory_roleplay_turn`、`openstory_roleplay_archive`、`openstory_roleplay_export`、`openstory_roleplay_promote`、`openstory_roleplay_pending`、`openstory_roleplay_branch`、`openstory_roleplay_opening`、`openstory_roleplay_scene_turn` | [sessions.md](sessions.md)、[deduce.md](deduce.md) |
| 扮演素材 | `openstory_assets`、`openstory_asset_read`、`openstory_asset_put`、`openstory_deduce_image`：角色/场景/BGM 素材盘点、读取、受限写入与推演生图 | [assets.md](assets.md) |
| 建库 | `openstory_library_create`、`openstory_library_diagnose`、`openstory_library_scan`、`openstory_library_import`、`openstory_library_primary`：建库、只读诊断、扫描计划、导入与主载体切换 | [library.md](library.md) |
| 套件 | `openstory_suites`、`openstory_suite_enable`、`openstory_suite_settings`：套件货架、库级启停与设置 | [suites.md](suites.md) |
| 导入导出 | `openstory_exchange_export`、`openstory_exchange_import`：事实书与 `pedia/v1` / `jsonl` 互转 | [exchange.md](exchange.md) |
| 剧本互转 | `openstory_script_to_fact`、`openstory_script_from_fact`：剧本与 fact 骨架的纯结构映射/渲染，不直接写盘 | [script.md](script.md) |
| 技能货架 | `openstory_skills_list`、`openstory_skills_read`：发现并读取创作与操作说明书 | 见下 |
| 分析 | `openstory_analysis_chapter`：纯本地文本分析 | [analysis.md](analysis.md) |
| 插件与状态 | `openstory_plugins`：读模块/能力图投影；`openstory_ui_state`：经能力图事务合并写库界面状态 | [plugins.md](plugins.md) |

**习惯表**：`openstory_habits_read` 读文风自述、禁用词/惯用词、禁用句式等规矩——写正文或世界书前必读，产出必须逐条遵循。`openstory_habits_put` 是整表覆盖，只在作者明确要求调整时使用。正文与世界书写入会回显习惯命中；命中后先改产出，不删规矩。

## 标准开场

```text
1. openstory_libraries                         → 拿 root
2. openstory_files {root}                      → 看目录结构
3. openstory_library_diagnose {root}           → 建库/升级前确认库形状
4. openstory_habits_read {root}                → 写作任务先读作者规矩
5. openstory_skills_read {name:"build-project"} → 构建项目时读官方操作说明书
6. openstory_skills_read {name:"update-project"} → 升级/迁移既有项目时读操作说明书
7. 按任务进入上表对应域
```

`root` 是库的绝对路径，不是正文文件路径。只有确实没有库时才在作者指定的绝对路径调用 `openstory_library_create`。

## 技能货架

用 `openstory_skills_list` / `openstory_skills_read` 按需发现与读取。技能货架包含 33 个内置配方＋2 个套件捆绑，分 `craft` 技法、`review` 审阅、`transform` 改写、`extract` 抽取、`operate` 操作说明书五类。`review` 只出问题清单，`transform` 产提案，`extract` 产数据；`operate` **不自动注入 prompt、不产出小说内容、不执行代码**，写操作只能调用其声明的官方 MCP 工具。两份 `operate` 正片：`build-project`（建库/内容构建）与 `update-project`（升级/迁移/版本冲突）；后者只声明升级五工具，`apply` 必须 `confirm:'migrate'` 且等作者明确确认，详见 `docs/mcp/library.md`。

## 确认与写入红线

1. **确认级别**：`read < create < migrate < restore`。所有工具都接受 `confirm` 实参；无条件写工具每次调用都必须满足最低门槛。只读工具可省略，条件写只在命中升级条件时要求写确认。
2. **`confirm: 'create'` 不是“可选提示”**：覆盖写、新建、导入、状态写、素材写和会话推进等操作缺确认会返回 `isError:true` + `CONFIRM_REQUIRED`。删除或重置使用 `confirm: 'restore'`。
3. **条件写**：`openstory_deduce_present` 正常续拍要求 create，`reset:true` 升到 restore；`openstory_exchange_export` 缺省只回数据，`save:true` 才要求 create。
4. **写入先读、留痕**：正文、世界书和整存覆盖会先备份到 `.history`；章节删除也是备份而非真删。事实整份替换还校验 schema、推进 revision，并可用 `operationId` 幂等重放。
5. **世界书专用端点**：世界书写入只走 `PUT /api/reference/note`（MCP 工具为 `openstory_reference_write_note`）；通用章节端点不再承担世界书写入。
6. **事实合法写入链**：`openstory_fact_books` → `openstory_fact_entries` → `openstory_fact_entries_import`。导入是**整份替换**，不是合并；`openstory_enrich_run` 只做旁挂 wiki 富化，不能替代 fact 主档写入。
7. **世界书单向链小说**：世界书笔记可以 `[[正文/001-xxx.md|别名]]`；正文不要回挂世界书，避免污染纯净写作面。
8. **absorb 不开 MCP**：旧目录迁入世界书是显式动稿操作，只走界面；MCP 导入工具只处理其声明支持的导入计划，不替代升级。旧库升级走下方「升级确认链」五工具（`openstory_skills_read {name:"update-project"}` 读说明书），不是 absorb。
9. **Agent 对话与待确认卡不在 MCP 里**：`openstory_roleplay_pending` 只结算已存在的卡，不创建卡；外部 agent 自己承担写前自查。
10. **enrich 是长任务**：启动后保存 jobId，用 `openstory_enrich_status` 轮询，不同步等待。

## 协议约定

- 业务错误：`result.isError: true`，文本以错误码开头（如 `NO_LIBRARY`、`CONFIRM_REQUIRED`、`WORLD_EMPTY`）；这不是 JSON-RPC 协议失败。
- 参数缺失或形状错误：JSON-RPC `-32602`。
- 未知工具或方法：`-32601`。
