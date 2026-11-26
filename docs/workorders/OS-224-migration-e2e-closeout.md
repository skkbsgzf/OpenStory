# OS-224 · 迁移 E2E 与阶段 B 收口

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 B 收口 |
| 执行 | workflow 施工；dsv4flash；hy4flash 评审 |
| 依赖 | OS-223 |
| 允许改动 | `test/libraryUpgrade*.test.mjs`、`test/capabilityMigration*.test.mjs`、`test/mcpDaemon.test.mjs`、`tools/verify/**`、`.github/workflows/ci.yml`、`docs/ACCEPTANCE.md`、`docs/PUBLISHING.md`、`docs/mcp/**`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/number-anchors.json` |
| 风险 | 高——迁移安全证据 |
| 状态 | 待施工 |

## 目标

用真实临时旧库与能力迁移夹具证明 update-project 全链安全，并接入 CI。

## 任务

1. 旧 spec/carrier/目录 fixture：预览零写入→确认执行→目录/schema/路径正确→备份清单/字节校验→重复执行幂等。
2. capability migration：成功、journal done、失败剔除覆盖者、中断恢复、部分提交回滚、回滚失败上报。
3. DATA_VERSION_AHEAD：数据升档后路由回落旧 provider，HTTP 与 MCP 都拒读；未迁库不受影响。
4. 22+ 失败注入点：备份、目录迁移、文件改写、marker、changelog；断言 rolledBack:true；单独构造 rollbackErrors。
5. plan 漂移：预览后改文件、改迁移器摘要、confirm:false、错参数；必须零写入。
6. CI 增加迁移 E2E；文档写明自动升级与显式 update-project 的边界；数字锚/阶段验收记录。

## 验收

- 迁移 E2E 全绿；反证全部变红。
- 全量测试两轮、验收、arch、number anchors、CI 结构、既有隔离 E2E、MCP 构建 E2E 不回退。
- 不 push；不降低任何既有断言。
