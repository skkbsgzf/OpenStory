# OS-218 · 新《水浒传》样本落盘与构建批收口

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-217 |
| 允许改动 | `samples/水浒传/**`、`docs/DEMO.md`、`README.md`、`tools/samples/**`、`tools/verify/**`、`test/sampleConfig.test.mjs`、`test/**`、`docs/mcp/**`、`ARCHITECTURE.md`、`docs/number-anchors.json` |
| 风险 | 高——替换公开样例 |
| 状态 | 待施工 |

## 目标

用 MCP-only 构建器重新生成《水浒传》，让它成为新架构的有效验收资产。

## 任务

1. 在临时目录运行 OS-217 构建器，产出候选样本；逐工作台与语义 digest 校验通过后，才整体替换 `samples/水浒传`。
2. 样本只留白名单内容与必要运行态；不得带日志、history、tmp、凭据、本机绝对路径或迁移残留。
3. fact 全部合法；wiki revision 与主档一致；正文/世界书/习惯/剧本/多局/素材/导出达到构建配方目标。
4. 重写 `samples/水浒传/README.md` 与 `docs/DEMO.md`：说明由 MCP＋build-project 构建、覆盖能力、复现命令、已知边界；不再宣称“手搓 fact 也过 schema”。
5. 更新 sampleConfig、E2E、页面 fixture 与数字锚；保持旧样本内容可读性，不为了通过而删功能数据。

## 验收

- 候选样本与 clean-room digest 一致；替换过程可回滚，旧样本不丢失到不可恢复状态。
- `npm test`、验收、arch、number anchors、隔离 E2E、MCP clean-room E2E 全绿。
- 发布洁净检查通过；无真实路径/密钥/日志噪声。
- 不 push；版本仍 0.2.0，依赖不动，app.js 不增。
