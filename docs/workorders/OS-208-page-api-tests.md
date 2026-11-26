# OS-208 · 页面必需后端 API 测试

| 项 | 值 |
|---|---|
| 批次 | 第五批第 3 张；规划见 [`page-testing-batch-20261126.md`](../plan/page-testing-batch-20261126.md) |
| 执行 | **监督线独立施工** |
| 依赖 | OS-206 |
| 允许改动 | `test/**`、`tools/**`、`src/**`（仅修真实缺陷）、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/number-anchors.json` |
| 风险 | 中高——补真实 HTTP 缺口，可能暴露产品 bug |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

由同一页面矩阵驱动，验证每个页面所需 API 在临时 daemon 上返回契约合法、业务状态正确的数据；补当前没有 HTTP 覆盖的必要端点。

## 任务

### 1. `test/pageApiSmoke.test.mjs`

- 从 `pageMatrix` 的 `requiredApi` 逐页请求；
- 校验 `validateResponse(endpointId, payload)`；
- 页面投影、slot、模块状态与 API 一致；
- 空库、缺目录、模块停用、能力降级时 API 与前端空态/说明态一致；
- 两个临时库 A/B 交替请求，验证按 root 隔离、不串数据。

### 2. 补端点

- 日志：`GET /api/log`、`GET /api/log/entry`、`POST /api/log/restore`、`GET /api/log/summary`；
- 草稿：`GET/PUT /api/draft`（upsert/read/delete、路径、停用语义）；
- Agent：`GET /api/agent/dsh/models`、`POST /api/agent/sessions`、`GET/PUT /api/agent-picks`；
- 同步与偏好：`POST /api/sync/check`、`GET/PUT /api/ui-preferences`；
- 任务：`GET /api/jobs`、`POST /api/jobs/cancel`、`POST /api/jobs/clear`；
- 文件：`POST /api/dir`；
- 知识库：`GET/PUT /api/kb/config`、`POST /api/kb/test`。

### 3. 每类至少覆盖

成功、缺参/错类型、路径越界/未授权、停用/降级、幂等或冲突、数据不残留。外部服务用假上游或明确的无配置降级，不依赖本机 CLI/网络。

## 验收

- 新测试全绿；既有测试无删弱；
- 页面矩阵中每个 `requiredApi` 至少有一条真实 HTTP 用例；
- 反证：让某端点返回错形状、让某 root 串库、让停用模块仍返回成功，测试必须红；
- 端点 108 与 MCP 名不变，`app.js` 不增。
