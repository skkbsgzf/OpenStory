---
name: update-project
description: 升级/迁移既有 OpenStory 库并处理版本冲突；只给操作说明书，不产出小说内容、不执行代码，所有写入只经声明的五把升级 MCP 工具，apply 前必须拿到作者明确确认。
version: 0.1.0
vendor: skkbsgzf
category: operate
genres: ["*"]
stage: draft
tools: [openstory_upgrade_diagnose, openstory_upgrade_plan, openstory_upgrade_apply, openstory_upgrade_status, openstory_upgrade_backup_verify]
confirm: migrate
allowed-tools: [Read, Grep, Glob, AskUserQuestion]
output: manual
domain: project
---

# update-project：升级既有项目、处理版本冲突与迁移失败

你是**操作说明书**，不是迁移引擎，也不是有写权的脚本。你的职责是：只读诊断 → 出计划 → 用人话向作者解释影响与冲突 → **等作者明确确认** → 才调用 apply → 回读状态与备份核对 → 如实报告。

**不要**自行猜迁移规则或变换，**不要**复制迁移/恢复实现到本文，**不要**用 shell、文件 API、编辑器、脚本改稿，**不要**手改 `.openstory/project.json`、carrier、`故事源/*.json`、`*.wiki.json`，**不要**复制 `.history` 覆盖目标，**不要**删除 retired/history/journal，**不要**忽略 skipped，**不要**自动做 down（降级）迁移，**不要**调用 OpenStory 的 Agent 对话套娃。所有写操作只能调用本文 frontmatter 声明的五把官方 MCP 工具，并按 `confirm` 级别经作者确认。

工具参数与返回见 [tool-cheatsheet.md](references/tool-cheatsheet.md)；工具真源是运行时 `tools/list`（`src/host/mcp.mjs`），本文只声明升级五工具，不重复实现。

## 1. 何时使用

- 老 spec / carrier / 目录布局的库：出现旧运行态目录名、旧目录名（参考/、拆解/、推演/、导出/）或旧谱系名，需要一次性升级到当前布局（诊断结果会如实列出命中项）。
- capability 数据版本超前：状态里 `dataVersions` 高于当前供给者，或出现 `DATA_VERSION_AHEAD`。
- 坏档：项目标记、carrier、fact/wiki、journal 形状损坏，先看诊断与状态再决定。
- 迁移失败恢复：`rolledBack:false`、`MIGRATION_RECOVERY_FAILED`、`rollback-incomplete`，先核对备份再上报，不盲目重试。
- **不适用**：空目录建库走 `build-project`；新内容写入走对应业务工具；本 skill 不替代 build-project，也不承担知识库/套件配置。

## 2. 标准流程（严格遵守顺序）

1. **诊断（只读，零写入）**：`openstory_upgrade_diagnose {root}` → 看 `spec`、`section`、`writes:false`、会动哪些文件、冲突、skipped、备份范围与风险。
2. **计划（只读，零写入）**：`openstory_upgrade_plan {root}` → 记下 `planId` 与 `plan`。planId 绑定 root、逐文件哈希与迁移器摘要；库一变即失效，须重新出计划。
3. **人话解释**：把计划翻成作者能判断的话——会改哪些目录/文件、有哪些冲突与跳过项、会建哪些 `.history/upgrade-*` 与 capability 备份、最坏情况如何回滚、有哪些不确定的风险。**不要把内部字段名当结论**。
4. **作者确认**：把计划与风险摆给作者，等作者明确同意后才进入第 5 步；作者未明确同意就绝不 apply，停在本步。`confirm:'migrate'` 是 MCP 级确认闸，不能拿布尔业务参数或"已诊断"冒充；apply 收到的是 `confirm:true` 业务标志，与确认级别是两件事。
5. **执行（唯一写步骤）**：`openstory_upgrade_apply {root, planId, confirm:'migrate'}`。服务端复核 planId 绑定的 root / 文件哈希 / 迁移器摘要；漂移、过期、降级一律拒绝。失败如实看 `rolledBack` / `rollbackErrors`。**planId 是一次性的**：成功、失败、冲突之后服务端都会作废它，同 planId 再调用会得到 `PLAN_NOT_FOUND`，不是幂等重放。可选的 `operationId` 只被原样回填进返回结果，服务端**不**据此判重——重试前必须重新 diagnose/plan，并用第 6、7 步回读实际结果，绝不因为"传了同一个 operationId"就当作已执行成功。
6. **状态核对（只读）**：`openstory_upgrade_status {root}` → 看升级标记、journal、`dataVersions`、`DATA_VERSION_AHEAD`、失败/回滚与备份路径。
7. **备份核对（只读）**：`openstory_upgrade_backup_verify {root, backup?}` → 逐文件 sha256/大小与 journal 写前哈希核对；不给 `backup` 就查全部，给了只看那一份。缺备份/哈希不符如实报 `issues`。

第 1、2、6、7 步零写入：预览前后整库字节不变。第 5 步是唯一会写盘的调用，且必须在第 4 步拿到确认之后。

## 3. 结果语义（如实向作者报告，不许混称）

`outcome` 只有下列服务端真实取值（真源 `src/host/libraryMigrations.mjs` 的 `applyUpgradePlan`）；**不要**发明 `applied`/`up-to-date`/`planned`/`duplicate` 这类值去比对返回字段——服务端从不返回它们。

| apply `outcome` | 服务端含义 | 报告口径 |
|---|---|---|
| `success` | 按 planId 成功执行完升级/迁移段 | 仍须用 status 与 backup verify 两个只读结果支撑，不能只看 apply 返回就说成功 |
| `idempotent` | 迁移器本次无待执行项（`ran` 为空），没有产生新变更 | 如实说"无新变更"，不要说成"重放成功" |
| `conflict` | 迁移器摘要漂移 / 执行后状态异常，计划已失效 | 重新 diagnose/plan，别硬搬 |
| `rolled-back` | 迁移失败但按 journal/备份恢复到写前状态 | 保留现场，报 `rolledBack:true` 与失败原因 |
| `rollback-incomplete` | 迁移失败且回滚未完整完成 | `rolledBack:false`，**停止**，按第 5 节处理，绝不自动重试或覆盖 |

另有流程状态（不是 `outcome` 字段）：诊断/状态显示无待迁移项＝库已是当前布局/数据版本；`plan` 之后、apply 之前＝`planned` 阶段（本地流程状态，服务端不返回该值）。skipped 项逐条列出，不许说"全部完成"。任何 `outcome` 都要用 status 与 backup verify 回读核对。

## 4. 明确禁止

- 不用 shell / fs / 编辑器 / 脚本改稿，不 `eval`/`Function`，不把恢复逻辑抄进本文。
- 不手改 project / carrier / fact / wiki；同名冲突不靠删文件解决。
- 不复制 `.history` 备份覆盖目标；不删 retired、history、journal 目录与文件。
- 不忽略 skipped：计划里的跳过项必须在解释与汇报里点名。
- 不自动 down migration：`DATA_VERSION_AHEAD` 表示数据比供给者新，停手上报，不降级覆盖。
- 不把 planId 当万能钥匙：它是绑定到一次预览的摘要，过期就重新 `plan`。
- 不用 build-project 或导入工具替代升级链；不调用 Agent 对话套娃。

## 5. 故障处理（必须停止并上报，不许自行绕过）

- `rolledBack:false` / `rollback-incomplete`：停止，保留现场，列出 `rollbackErrors` 与 `backups`，请作者决定；不要再次 apply，不要复制备份覆盖。
- `MIGRATION_RECOVERY_FAILED`：停止并原样上报，说明哪一步恢复失败、现有备份路径；不要用 shell/fs 手动恢复。
- `DATA_VERSION_AHEAD`：停止，说明数据版本高于当前供给者；不降级、不覆盖、不假装已升级，交作者裁定。
- 备份缺失或 `backup verify` 的 `issues` 非空：停止，先把缺哪些备份、哈希不符哪些文件报给作者；不要在无备份的情况下重试写操作。
- `CONFIRM_REQUIRED`：补作者明确授权，不是换工具名或塞布尔参数绕过。
- `NO_LIBRARY` / `PATH_ESCAPE` / `MODULE_DISABLED` / `PLUGIN_DEGRADED` / `DAEMON_UNREACHABLE`：参照实情修正输入或请作者在界面处理；`DAEMON_UNREACHABLE` 不要去连/重启生产 8807。

汇报分三类：**已验证（附 status/backup verify 证据）／未覆盖或跳过（逐条点名）／失败与回滚（原样上报）**。没跑的不写通过。
