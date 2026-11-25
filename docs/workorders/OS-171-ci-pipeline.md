# OS-171 · CI 就绪流水线（第三批基建）

| 项 | 值 |
|---|---|
| 批次 | 第三批·收尾批（作者验收意见 S5 的出口之后） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 收尾批 |
| 依赖 | **OS-169、OS-170 验收通过**（即出口条件 S5：前两批关闭，准予上 CI） |
| 允许改动 | `.github/**`、`docs/**`、`README.md`、`AGENTS.md`、`PUBLISHING.md`、`tools/**`、`package.json`（只许改 `scripts`） |
| 风险 | 低 |
| 状态 | 已验收（2026-11-25 主 agent 独立完成，本地等价命令全绿，待提交后远端首跑） |

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

## 施工回报（主 agent 独立完成）

CHANGED:
- `.github/workflows/ci.yml`（新增）：push／pull request 触发，Node 24，`npm install` 后连续两轮 `npm test`，再跑验收门禁与 `arch-stats --check`；`tee` 管线启用 `pipefail`，失败时上传四份日志产物（保留 7 天）。
- `tools/verify/verify-ci-workflow.mjs`（新增）：零依赖 Node YAML 子集解析＋工作流结构校验，钉死 Node 24、两轮测试、验收、arch check、失败产物与管道退出码。
- `tools/acceptance/acceptance.mjs`：S0.1 根目录白名单登记 `.github`。
- `docs/ACCEPTANCE.md`：补 CI 门禁行与「CI 门槛＝测试两轮＋验收门禁＋数字锚；e2e 仍是本地门禁」。
- `README.md`、`AGENTS.md`：写明 CI 是合入门禁，本地先跑同样三条命令。
- `docs/plan/workorder-system-20261124.md`：根目录白名单 16→17、实测条目 26→27。

VERIFIED:
- `node --check tools/verify/verify-ci-workflow.mjs && node tools/verify/verify-ci-workflow.mjs` → YAML 子集解析与结构校验通过。
- 工单逐字命令 `npm test && npm test && node tools/acceptance/acceptance.mjs && node tools/arch-stats.mjs --check` → **全绿**：两轮均 686 tests / 684 pass / 2 skip / 0 fail；验收 25 过 / 0 挂 / 0 警；架构生成段一致。
- 首轮等价复跑曾正确暴露 `.github` 未登记根目录白名单（S0.1 24 过 / 1 挂）；登记后重跑恢复 25/25。
- `git diff --check` 无 whitespace 错误。

LIMITATIONS:
- 未执行 git push，因此 GitHub 远端 Actions 尚未首跑；提交后需在 GitHub 上确认实际 job 与产物。工作流已通过本地零依赖结构校验，但未引入 actionlint 或额外 CI 依赖。

## 验收记录（主 agent 填）

- 2026-11-25 主 agent 独立验收通过：工作流结构合法，本地等价命令连续两轮测试＋验收＋架构核对全绿。
- 两条 e2e 未进 CI，已在验收文档明确为本地门禁；未启动/杀 daemon，未碰真实库或真实本机院子。
- 待作者统一提交后回填提交号，并观察远端 Actions 首跑。
