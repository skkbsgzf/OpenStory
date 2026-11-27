# OS-223 · 官方 update-project skill

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 B |
| 执行 | workflow 方案 C；dsv4flash / hy4flash 交替施工，波末由对方模型汇总独立评审 |
| 依赖 | OS-222 |
| 允许改动 | `skills/update-project/**`、`src/services/skills.mjs`（如必须）、`src/host/mcp.mjs`（instructions/说明）、`test/skills.test.mjs`、`test/mcpDaemon.test.mjs`、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 高——升级操作说明书 |
| 状态 | 已完成（监督线直做；2026-11-27） |

## 目标

让 agent 能解释版本冲突、生成计划、要求作者确认并核对迁移结果，但不能自行猜迁移规则或手改文件。

## 任务

产出 `skills/update-project/SKILL.md` 与速查表：

1. 何时使用：新老 spec/carrier/目录、capability 数据版本超前、坏档、迁移失败恢复。
2. 标准流程：diagnose → plan → 人话解释影响/冲突/备份 → 作者确认 → apply → status → backup verify。
3. 结果语义：up-to-date、planned、applied、duplicate、conflict、rolled-back、rollback-incomplete。
4. 禁止：shell/fs 改稿、手改 project/carrier/fact/wiki、复制 history 覆盖、删 retired/history/journal、忽略 skipped、自动 down migration。
5. 故障处理：rolledBack:false、MIGRATION_RECOVERY_FAILED、DATA_VERSION_AHEAD、备份缺失时必须停止并上报。
6. tools 只声明 diagnose/plan/apply/status/backup verify，并按 operate 确认级别校验。

## 验收

- skill 可装载/读取；工具白名单与真实 MCP 一致；未声明/危险工具门禁变红。
- 用临时旧库演练，agent 仅凭 skill 能给出正确计划与确认点；apply 前必须等待作者明确确认。
- 不在 skill 中复制迁移变换或恢复实现；全量测试、验收、数字锚全绿。
- 不 push。
