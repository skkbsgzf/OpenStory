# OS-222 · 确认执行与 MCP 升级工具

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 B |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-221 |
| 允许改动 | `src/api/contracts/**`、`src/api/handlers/**`、`src/protocol/libraryUpgrade.mjs`、`src/protocol/capabilityMigration.mjs`、`src/host/libraryMigrations.mjs`、`src/host/mcp.mjs`、`test/mcpDaemon.test.mjs`、`test/libraryUpgrade.test.mjs`、`test/capabilityMigration*.test.mjs`、`docs/mcp/**`、相关数字锚 |
| 风险 | 高——显式动稿 |
| 状态 | 待施工 |

## 目标

提供 diagnose→plan→confirm→apply→status/backup verify 的安全执行闭环，并薄适配到 MCP。

## 任务

1. apply 必须带 planId、confirm:true、可选 operationId；服务端复核 root、文件哈希、迁移器摘要未变。
2. confirm:false、无 plan、过期/不存在 plan、预览后文件变化、摘要变化均拒绝，零写入。
3. 执行复用现有 journal、备份、原子写与回滚；不新增直接复制/覆盖文件的捷径。
4. MCP 新增 diagnose/plan/apply/status/backup verify；读级工具可自动，apply 必须作者明确确认。
5. 结果区分成功、幂等、冲突、失败已回滚、回滚未完成；保留 journal/backup 路径供核对。
6. 既有首次打开自动升级行为保留；显式更新走新链，不破坏旧调用方。

## 验收

- 真实临时旧库走通预览→确认→执行→备份校验；preview 零写入。
- plan 漂移、confirm:false、错类型/额外参数、未授权 root、DATA_VERSION_AHEAD、备份失败均有负向。
- 失败注入证明 rolledBack:true；回滚失败明确 rolledBack:false 且不自动重试。
- MCP stdout/EOF/错误信封通过；全量测试、验收、数字锚全绿。
- 不 push。
