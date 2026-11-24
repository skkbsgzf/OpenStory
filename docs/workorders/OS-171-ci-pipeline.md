# OS-171 · CI 就绪流水线（第三批基建）

| 项 | 值 |
|---|---|
| 批次 | 第三批·收尾批（作者验收意见 S5 的出口之后） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 收尾批 |
| 依赖 | **OS-169、OS-170 验收通过**（即出口条件 S5：前两批关闭，准予上 CI） |
| 允许改动 | `.github/**`、`docs/**`、`README.md`、`AGENTS.md`、`PUBLISHING.md`、`tools/**`、`package.json`（只许改 `scripts`） |
| 风险 | 低 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

仓库有一条**零依赖、零构建**的 CI：每次推送与合并请求跑 `npm test` 两轮＋验收门禁，全绿才算过。门槛与本地完全一致，本地绿则 CI 绿。

## 任务

1. 新增 `.github/workflows/ci.yml`（作者若另有 CI，改触发器即可）：
   - Node 24；不执行 `npm install` 之外的任何安装（本仓只有一个依赖）；
   - 步骤一：`npm test` **连跑两轮**，任一轮有 fail 即红；
   - 步骤二：`node tools/acceptance/acceptance.mjs`；
   - 步骤三：`node tools/arch-stats.mjs --check`；
   - 失败时把测试输出与门禁输出留作产物。
2. 两条 e2e（水浒／新建）**不进 CI**：它们要连 8807 的常驻 daemon 与本机夹具。在 `docs/ACCEPTANCE.md` 写明「CI 门槛＝测试两轮＋验收门禁＋数字锚；e2e 仍是本地门禁」。
3. `README.md` 与 `AGENTS.md` 写一句：CI 是合入门禁，本地先跑同样的三条命令。
4. `docs/ACCEPTANCE.md` 的门禁表补「CI」一行。

## 不做

- 不引入任何 CI 插件、缓存_action、矩阵构建；不换测试框架。
- 不动产品代码与测试断言。

## 验收

- 工作流 YAML 语法合法（用现有 Node 做一次 YAML 解析校验，不引依赖）。
- **本地等价命令**连跑结果贴进报告：`npm test && npm test && node tools/acceptance/acceptance.mjs && node tools/arch-stats.mjs --check` 全绿。
- 全量测试与验收门禁全绿（本单不该改变它们）。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
