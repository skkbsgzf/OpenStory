# OS-215 · MCP 构建原语 II

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-213、OS-214 |
| 允许改动 | `src/host/mcp.mjs`、`test/mcp.test.mjs`、`test/mcpDaemon.test.mjs`、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 中高——工具面与写安全 |
| 状态 | 待施工 |

## 目标

把 OS-214 的服务端剧本/多局/扮演动作包装成 MCP，并补章节 rename 与素材/推演生图工具。

## 任务

1. 剧本互转工具：script→fact、fact→script；输入明确 root/bookId/format/覆盖策略；返回 revision、条目数、警告与备份。
2. 会话工具：list/get/new/switch/delete；角色/会话参数完整，错误语义与 HTTP 一致。
3. 扮演动作工具：turn/archive/export/promote/pending/branch；写动作 description 明示备份、确认与不可自动 absorb。
4. 素材工具：assets 列表、asset 读取；推演生图走现有端点；二进制/模型错误明确。
5. 章节 rename；不开放 absorb、Agent 对话/待确认卡。
6. 工具名、schema、description、文档与实际行为一致；旧工具零回归。

## 验收

- 新工具全部映射到 OS-214 的真实端点；假上游下 turn/export/promote 全链通过。
- 多局切换、最后一局拒删、重复 pending、路径越界、模型不可用、模块停用均有断言。
- 参数错类型/枚举/额外参数在 JSON-RPC -32602；业务错误 isError:true。
- 不 push；全量测试、验收、数字锚全绿。
