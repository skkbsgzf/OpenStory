---
name: build-project
description: 从空目录初始化并构建一个可用的 OpenStory 项目；只给操作说明书，不产出小说内容、不执行代码，所有写入只经声明的官方 MCP 工具。
version: 0.1.0
vendor: skkbsgzf
category: operate
genres: ["*"]
stage: draft
tools: [openstory_libraries, openstory_files, openstory_novel_list_chapters, openstory_novel_read_chapter, openstory_novel_write_chapter, openstory_novel_new_chapter, openstory_novel_delete_chapter, openstory_chapters_rename, openstory_reference_index, openstory_reference_graph, openstory_reference_read_note, openstory_reference_write_note, openstory_habits_read, openstory_habits_put, openstory_vision_describe, openstory_image_generate, openstory_deduce_present, openstory_deduce_settle, openstory_enrich_run, openstory_enrich_status, openstory_enrich_graph, openstory_fact_curve, openstory_analysis_chapter, openstory_skills_list, openstory_skills_read, openstory_library_create, openstory_library_diagnose, openstory_library_scan, openstory_library_import, openstory_library_primary, openstory_suites, openstory_suite_enable, openstory_suite_settings, openstory_fact_books, openstory_fact_entries, openstory_fact_entries_import, openstory_exchange_export, openstory_exchange_import, openstory_script_to_fact, openstory_script_from_fact, openstory_sessions, openstory_session_get, openstory_session_new, openstory_session_switch, openstory_session_delete, openstory_session_put, openstory_roleplay_turn, openstory_roleplay_archive, openstory_roleplay_export, openstory_roleplay_promote, openstory_roleplay_pending, openstory_roleplay_branch, openstory_assets, openstory_asset_read, openstory_asset_put, openstory_deduce_image, openstory_plugins, openstory_roleplay_opening, openstory_roleplay_scene_turn, openstory_ui_state]
confirm: restore
allowed-tools: [Read, Grep, Glob, AskUserQuestion]
output: manual
domain: project
---

# build-project：从空目录构建 OpenStory 项目

你是**操作说明书**，不是创作模型。你的职责是：按作者确认的计划，调用官方 MCP 工具初始化库、写入作者提供或作者批准的内容、逐步回读验证，并如实报告无法完成的步骤。

**不要**用 shell、文件 API、编辑器写盘来替代 MCP；**不要**复制 `.history` 覆盖目标；**不要**删除 retired 目录；**不要**自动 absorb；**不要**调用 OpenStory 的 Agent 对话来套娃。本文所列工具以当前 OpenStory 的 `tools/list`（60 个）为准，参数细节见 [tool-cheatsheet.md](references/tool-cheatsheet.md)。

## 1. 开始前：先拿授权与事实

1. 让作者明确：库的绝对路径、显示名、主载体（小说或剧本）、题材、要构建的工作面、内容来源，以及哪些写操作已获确认。
2. 调 `openstory_libraries`。若目标路径已在清单里，先 `openstory_library_diagnose`，不要重复建库。
3. 读 `openstory_habits_read`（有库后）与必要的 craft 技能。写作内容必须遵守作者习惯；本说明书本身不会自动注入 craft prompt。
4. 内容从哪里来要分清：
   - **作者/受控配方提供**：你可以按计划经 MCP 落盘；
   - **需要模型生成**： enrich、扮演正文、识图、生图必须有可用上游，失败就如实报告，不能把假上游结果说成真实语义生成。
5. 每次写调用都带注册表要求的 `confirm`。普通写工具最低通常为 `create`，删除/清盘为 `restore`，条件写按实际参数升级；本 skill 声明了完整构建工具集，因此 frontmatter 采用最坏级别 `restore`。**不要**把确认级别当成可省略的形式参数。

## 2. 建库与基础配置

### 2.1 空目录建库

按顺序：

1. `openstory_library_create {path, name, primaryCarrier?}` → 记下返回的 `root`、`document`、`needsPrimary`。
2. `openstory_library_diagnose {root}` → 核对 `shape/verdict`。
3. `openstory_libraries` → 确认新库可读回。
4. 若 `needsPrimary:true` 或要切载体，调 `openstory_library_primary {root, primaryCarrier, expectedRevision?, confirm}`。载体 id 用诊断/文档给出的真实值，不猜模块名。

### 2.2 套件

1. `openstory_suites {root?}` → 选作者需要的套件 id。
2. `openstory_suite_enable {id, enabled, root?, confirm:'create'}` → 启停。
3. `openstory_suite_settings {id, values, root?, confirm:'create'}` → 只覆盖传入键。
4. 再读 `openstory_suites` 验证状态；工作台模块与套件不是同一层，不要用套件开关冒充模块开关。

### 2.3 旧稿导入（仅作者明确要求）

1. `openstory_library_scan {root, sourcePath}` → 先看计划、冲突、跳过项；扫描零写入。
2. 作者确认计划后才 `openstory_library_import {root, sourcePath, confirm:'create'}`。
3. 回读 `openstory_files` 与 `openstory_library_diagnose`。不要为了“全部搬进来”放宽冲突处理。

## 3. 内容构建顺序

推荐顺序：**习惯 → 世界书 → 合法 fact → 正文/剧本 → 推演/扮演 → 素材 → exchange**。每一步写后都回读，不要等全部写完才发现 bookId、revision 或模块状态错了。

### 3.1 习惯

- 默认只读 `openstory_habits_read`。
- 只有作者明确要求改习惯表才 `openstory_habits_put`；它是整表覆盖，写前先读并保存旧值用于失败恢复。

### 3.2 世界书

- 先 `openstory_reference_index` 看现有条目与标签。
- 新增/整篇覆盖：`openstory_reference_write_note {root, file, text, confirm:'create'}`。`file` 必须在 `世界书/` 下。
- 写后 `openstory_reference_read_note` + `openstory_reference_index` 回读；需要关系时再看 `openstory_reference_graph`。
- 世界书是项目级创作知识，不是跨项目知识库；本阶段不新建独立知识库插件。

### 3.3 合法 fact（事实链第一）

1. `openstory_fact_books {root}` → 拿真实 `bookId`；没有书时，用一次合法 `openstory_fact_entries_import` 创建。
2. `openstory_fact_entries {root, bookId}` → 记下 `revision`、现有 `entries`。
3. 准备**完整**条目数组：`openstory_fact_entries_import` 是**整份替换**，不是增量合并。每条必须过 `fact.data/v3`；任一非法整份拒绝、零写入。
4. 调 `openstory_fact_entries_import {root, bookId, entries, title?, wiki?, operationId?, confirm:'create'}`：
   - `operationId` 用于幂等重放；
   - 成功响应带 `revision/backup`；
   - `wiki.derivedFrom.factRevision` 由内核按写后 revision 覆盖，不能靠调用方伪造。
5. 再读 `fact_books` + `fact_entries`，确认条目、revision、标题一致。

**不要**用章节写工具写 `故事源/*.json`。OS-211 起这条旁路会被载体闸拒绝。

### 3.4 正文与剧本

- 正文：`openstory_novel_list_chapters` → `openstory_novel_read_chapter` → `openstory_novel_write_chapter` 或 `openstory_novel_new_chapter`。
- 剧本文件同样可经章节写通道落到 `剧本/` 目录；它不是世界书，也不是 `故事源/`。
- 重命名用 `openstory_chapters_rename {root, file, title, confirm:'create'}`；保号、目标冲突拒绝。
- 删除是挪入 `.history`，仍需 `confirm:'restore'`，不是真删。
- 写后重新列章、读回，检查 `factStale`。`factStale:true` 表示正文比事实链新；**补事实应走合法 fact 写入或作者批准的 enrich，不要用 enrich 冒充手工 fact 写入口**。

### 3.5 剧本互转（确定性）

- `openstory_script_to_fact {root, text, bookId?, domain?}`：纯结构映射，返回 entries/wiki/stats，不写盘、不调模型。先检查，再决定是否用 `fact_entries_import` 落库。
- `openstory_script_from_fact {root, bookId?, entries?, wiki?}`：纯渲染，不写盘；空条目会报错。
- 互转结果与落库 revision 是两件事，不要把“转换成功”写成“事实链已更新”。

### 3.6 enrich（需要真实模型）

1. 先 `openstory_enrich_run {root, bookId, confirm:'create'}` → 拿 `jobId`。
2. 用 `openstory_enrich_status {jobId}` 轮询；长任务不要同步等待。
3. 完成后读 `openstory_enrich_graph`、`openstory_fact_entries`、`openstory_fact_curve` 核对关键窗口与 revision。
4. `job.state:'done'` **不是语义完整的充分条件**：至少检查人物/动机/关系/因果图/需求/台账等关键窗口不是空，派生 revision 与主档一致。
5. 无上游、空 fact、无 plot、窗口 parse-failed/empty 都要如实报告；不能用假上游的合法 JSON 冒充真实富化。

### 3.7 多局与扮演

- 列表：`openstory_sessions`；读：`openstory_session_get`；新建/切换/删除：`openstory_session_new/switch/delete`。最后一局拒删。
- `openstory_session_put` 是完整覆盖，不是补丁；日常推进优先用细粒度动作。
- `openstory_deduce_present` 生成确定性候选；`reset:true` 会清盘，必须 `confirm:'restore'`。
- `openstory_roleplay_turn` 当前包装 `/api/deduce/turn`：无模型仍可能保存节点并返回 `prose:''` + `proseError`，这不等于成功生成正文。
- `openstory_roleplay_archive/export` 写扮演目录；`promote` 把节点转正文（空正文会拒）；`pending` 只结算已有卡，重复 id 报 `NOT_FOUND`；`branch` 从节点开分支。
- 多角色扮演用 `openstory_roleplay_opening` 与 `openstory_roleplay_scene_turn`（对应 `/api/roleplay/opening` 与 `/api/roleplay/turn`，需模型）；`openstory_roleplay_turn` 仍是 `/api/deduce/turn` 的推演回合，两者不要混称。

### 3.8 素材

- `openstory_assets` 盘点角色/场景/BGM；`openstory_asset_read` 以 base64 dataUrl 读取 `.png/.mp3`（≤16MB）。
- `openstory_asset_put` 可把严格 base64 的 PNG/MP3 写进受控素材目录（≤16MB、验签名、默认不覆盖、覆盖前备份）；它不是任意文件写通道。场景图可在模型可用时用 `openstory_deduce_image` 生成，识图用 `openstory_vision_describe`。
- 素材缺失是合法空态，不伪造图片或声音。

## 4. exchange 与完成检查

1. `openstory_exchange_export {root, bookId, format}` 先只读导出；`save:true` 才落盘且需确认。
2. `openstory_exchange_import {root, bookId, format, text, dryRun:true, confirm:'create'}` 先 dry-run 看 errors/warnings/skipped；零写入。
3. 真导入前作者确认，再去掉 `dryRun`。写入仍受 fact schema 与备份约束。
4. 用 `openstory_ui_state {root,state,confirm:'create'}` 写必要的库级界面状态（如 typography），用 `openstory_plugins {root?}` 回读 modules/moduleGraph/slots/能力报告；完成前逐项回读：库清单、诊断、套件、习惯、世界书索引、fact books/entries/revision、章节、剧本、会话、素材、exchange 文件。
5. 汇报必须分三类：**已验证 / 未配置或不可用 / 未覆盖**。没跑的不要写通过。

## 5. 失败与恢复

- `NO_LIBRARY`：root 不在本机库清单；先建库或让作者登记，不绕过授权。
- `PATH_ESCAPE` / `INVALID_ENTRY`：路径或内容不合契约；修正输入，不扩大白名单。
- `MODULE_DISABLED`：所属工作台停用；让作者在 UI 恢复，不直接改盘。
- `PLUGIN_DEGRADED` / `CAPABILITY_*`：能力缺失或冲突；报告缺哪个能力。
- `CONFIRM_REQUIRED`：补作者已授权的确认级别，不是把工具改名绕过。
- `DAEMON_UNREACHABLE`：先启动本机 daemon；不要改连生产 8807 或重启作者的进程。
- `DATA_VERSION_AHEAD`：数据版本高于当前供给者；停止，保留现场，走 update-project，不降级覆盖。
- 写失败先读回当前 revision/内容；需要恢复时用返回的 `.history` 路径走受控界面恢复，不复制文件覆盖。
- 重复 `operationId` 应幂等；revision 对不上先重读，不盲目重放整份替换。

## 6. 明确边界（当前 60 工具）

- absorb 永不开 MCP；Agent 对话与待确认卡创建不开 MCP。
- 不手改业务盘，不复制 history 覆盖，不删除 retired。
- 模块投影可经 `openstory_plugins` 只读回读；工作台启停仍走界面，不要把套件状态当成模块投影。
- 素材写入只经 `openstory_asset_put` 的受限签名/base64 通道。
- 多角色扮演 opening/turn 需真实模型；无模型必须如实报错。
- 版本保持 `0.2.0`；既有工具名与端点不改，只使用真实存在的工具。
