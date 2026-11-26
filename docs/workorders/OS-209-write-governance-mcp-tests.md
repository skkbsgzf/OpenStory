# OS-209 · 关键写入、治理与 MCP 测试矩阵

| 项 | 值 |
|---|---|
| 批次 | 第五批第 4 张；规划见 [`page-testing-batch-20261126.md`](../plan/page-testing-batch-20261126.md) |
| 执行 | **监督线独立施工** |
| 依赖 | OS-206～208 |
| 允许改动 | `test/**`、`tools/**`、`src/**`（仅修真实缺陷）、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/number-anchors.json` |
| 风险 | 高——覆盖写入安全、模块治理与 MCP 真实链路 |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

补齐关键写入/配置/恢复/治理动作与 MCP 数据工具的真实成功和负向测试；不是为 108 个端点机械造最小请求。

## 任务

### 1. 写入与恢复

- 正文 CRUD、重命名、删除备份、日志恢复、草稿；
- 世界书 absorb、图片资产、二进制越界、部分失败；
- 导入导出 dryRun/真写/save、坏 JSON/JSONL、空书与冲突；
- Agent 卡片 adopt/reject、会话创建/重命名/删除；
- 配置/偏好/习惯/KB 配置的密钥保留、掩码、非法值。

### 2. 模块与治理

- 41 个模块独占端点逐一：健康 → 停用 409 → 恢复 → 数据字节不变；
- 共享端点在工作台停用后仍可用；
- 每个 workbench 的关键 `requires` 缺失组合；
- 模块根 preview/add/remove/refresh：confirm、路径、重复根、坏 manifest、候选失败保持旧层；
- 迁移失败、`DATA_VERSION_AHEAD`、`LIBRARY_UPGRADE_FAILED`；
- 本机模块运行期契约请求校验、响应校验、handler 异常信封。

### 3. 扮演

- settle、pending、session/manage、export、promote、roleplay opening/turn；
- 空会话、错误 action、revision 冲突、最后一局拒删、重复转正、模型不可用；
- 会话/素材写盘与 `.history` 留痕。

### 4. MCP 隔离集成

新增 `test/mcpDaemon.test.mjs`：

- 启动 `startDaemon({ port: 0 })`，MCP 子进程注入 `OPENSTORY_PORT=<随机端口>`；
- initialize/tools/list、24 工具的数据映射；
- 章节/世界书/习惯/图片/推演/enrich/fact/skills 工具真实调用；
- 参数错类型/缺参/额外参数、模块停用、业务错误信封；
- 写操作备份与幂等；
- stdin EOF/进程退出、stdout 不被日志污染；
- 删除或改写现有依赖 8807 的跳过逻辑（只改强，不改弱）。

## 验收

- 新矩阵全绿；既有测试无删弱；
- 41 个独占端点都有停用/恢复证据；
- MCP 全部 24 工具至少一次映射或明确负向用例，不再因 8807 不可达而跳过；
- 反证：去掉备份、让停用端点放行、让 MCP 连错端口、让响应契约失效，测试必须红；
- 端点/MCP 外部名不变，`app.js` 不增。
