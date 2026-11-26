# OS-213 · MCP 构建原语 I

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-211 |
| 允许改动 | `src/host/mcp.mjs`、`test/mcp.test.mjs`、`test/mcpDaemon.test.mjs`、`test/moduleEndpointMatrix.test.mjs`、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 中高——对外工具面扩大 |
| 状态 | 待施工 |

## 目标

补齐从空目录建库到基础内容产出的 MCP 原语，全部走现有 daemon HTTP，保持薄适配层。

## 任务

新增并测试以下工具（名称可在实现时按现有 `openstory_` 风格定稿，既有 24 个不改）：

1. 库：create、diagnose、scan/import、primary；create 必须明确绝对路径、名称、主载体；diagnose 不得意外触发升级（若现有端点会触发，先在产品层提供安全只读诊断或明确标注）。
2. 套件：list、enable/disable、settings put；复用 `/api/suites`、`/api/suite/state`、`/api/suite/settings`，带 root 时按该库状态。
3. fact：books、entries、entries import；import 明确整份替换语义与 operationId；响应带 revision、backup、wikiError/logError。
4. exchange：export/import；导出可 save，导入可 dryRun；错误信封与模块闸一致。
5. 工具 description 写清何时用、参数、返回、错误、备份与确认要求；不得宣称不存在的能力。

## 验收

- 所有新工具有真实临时 daemon 成功映射与参数/业务负向；24 个旧工具零回归。
- 建库后 libraries 能读回，套件启停即时反映投影，fact 导入后 books/entries 回读一致。
- exchange dryRun 零写入；save 有备份/留痕；未授权 root、缺参、错类型、模块停用有明确错误。
- MCP stdout 纯净、EOF 清理；全量测试、验收、数字锚全绿。
- 不 push。
