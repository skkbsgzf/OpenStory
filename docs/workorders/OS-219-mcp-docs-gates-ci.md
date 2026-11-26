# OS-219 · MCP 文档、门禁与构建链 CI

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A 收口 |
| 执行 | workflow 施工；dsv4flash；hy4flash 评审 |
| 依赖 | OS-218 |
| 允许改动 | `tools/acceptance/**`、`tools/verify/**`、`test/mcp*.test.mjs`、`test/skills.test.mjs`、`.github/workflows/ci.yml`、`docs/mcp/**`、`README.md`、`AGENTS.md`、`docs/ACCEPTANCE.md`、`docs/PUBLISHING.md`、`ARCHITECTURE.md`、`docs/number-anchors.json` |
| 风险 | 中——门禁与文档一致性 |
| 状态 | 待施工 |

## 目标

把 MCP 构建链变成持续门禁，并清除会误导 agent 的旧文档。

## 任务

1. 从真实 MCP `tools/list`/注册表生成工具名与 inputSchema 校验，不再只正则扫源码或允许 ±2 数量误差。
2. docs/mcp 每个工具名必须存在；每个 operate skill 的 tools 必须存在；只读/危险确认级别双向校验。
3. 构建链 CI：新增或扩展隔离脚本，跑建库→套件→内容→fact→剧本→多局→导出；失败留调用审计与报告。
4. 清理 `docs/mcp` 的旧 `参考/`、旧 fact 写入说明、错误 root 口径；更新工具数、技能 31+2 口径与 README/DEMO。
5. 回写架构统计、数字锚、验收覆盖；阶段 A 总验收记录与交接。

## 验收

- 删除一个文档工具名、声明不存在工具、让 CI 缺构建步骤，门禁必须红。
- CI workflow 结构校验通过；gates 与 browser-smoke 不回退。
- 全量测试两轮、验收、arch、number anchors、隔离 E2E、MCP clean-room E2E、完整 browser smoke 全绿。
- 不 push；既有端点/MCP 名不改，只新增。
