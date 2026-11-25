# OS-170 · 收尾：数字锚自动化＋文档对齐（S2 ／ A3）

| 项 | 值 |
|---|---|
| 批次 | 第三批·收尾批（作者验收意见 S2；即工作包 A3） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 收尾批、§4.1（`app.js` 行数上限锚） |
| 依赖 | 无（可与 OS-169 并行阅读，施工串行） |
| 允许改动 | `tools/**`、`test/**`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`package.json`（只许改 `scripts`） |
| 风险 | 低 |
| 状态 | 已验收（2026-11-25 主 agent 独立完成并复跑通过，待提交） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

文档里的数字从此**由门禁把关**，不再靠人追。`arch-stats --check` 已经开过先例（生成段逐字比对），本单把它推广到四类会漂的数字，并一次性对齐现有三处漂移。

## 主 agent 核对到的漂移

| 位置 | 问题 | 实测 |
|---|---|---|
| `docs/ACCEPTANCE.md`（约 :19）、`AGENTS.md`（约 :217） | 写 547 例 | 682 例（`docs/PUBLISHING.md` 已对） |
| `ARCHITECTURE.md`（约 :158） | 称宿主域「零端点零页签」 | library 的 manifest 有 `pinaxListGet`、`pinaxListImport`（OS-167 落地后没回写） |
| `app.js` 行数 | 双口径：生成表 11,886／PowerShell 11,249 | 没注明统计方式 |

## 任务

1. **验收门禁新增「文档数字＝实测」**（推广 `arch-stats --check` 的做法，只增不减），逐项比对、不符即红并打印差异：
   - 测试数（取 `node --test` 的汇总行）；
   - 端点数（取契约表的键数）；
   - 宿主域端点数（取 `builtin`／宿主域模块 manifest 声明的端点）；
   - `app.js` 行数口径注记（见任务 3）。
   做法建议：由 `tools/arch-stats.mjs` 再多生成一个「数字锚」段落（或一份机器可读的 JSON），文档引用它，门禁比对。
2. **三处漂移一次性对齐**：547→实测；「零端点零页签」改为实测并写明是哪几个端点；行数统一成一种口径。
3. **行数口径**：查清 11,886 与 11,249 差在哪（CRLF／空行／注释是否计入等），全仓统一采用生成表的口径，并在 `ARCHITECTURE.md` 写一句「行数按 X 口径统计」。
4. **`app.js` 行数上限锚进门禁**（S4 的落地件）：上限常量写进门禁，**只许下调不许上调**；当前锚 **11,886**。分批目标见规划 §4.1（A 批末 ≤11,800、B 批末 ≤11,600、C 批末 ≤10,500），本单只落当前锚与机制，后续批次各自下调。

## 不做

- 不改任何业务代码与既有测试断言。
- 不手改 `ARCHITECTURE.md` 的生成段（跑 `npm run arch:stats` 回写）。

## 验收

- 验收门禁全绿（新增一项）；全量测试全绿。
- 反证：手改 `docs/ACCEPTANCE.md` 里的测试数、或把行数上限锚临时调高，新门禁必须红；贴输出后改回。
- 报告贴：对齐后的三处原文、行数口径的结论。

## 施工回报（主 agent 独立完成）

CHANGED:
- `tools/number-anchors.mjs`（新增）：真实复跑 `node --test`，汇总测试数；从 `ENDPOINTS`、manifest 与覆盖面报告取端点数字；回写 `docs/number-anchors.json`；核对当前文档与 `app.js` 上限。
- `tools/arch-stats.mjs`：行数统一为物理行口径（CRLF/LF 归一、空行/注释计入、末尾换行不计）；端点改取 `ENDPOINTS` 键数；导出统计函数并加直跑判定。
- `tools/acceptance/acceptance.mjs`：新增 S2.8 数字锚门禁。
- `test/numberAnchors.test.mjs`（新增 4 例）、`test/finalAudit.test.mjs`、`test/moduleCoverage.test.mjs`：数字断言改读机器锚，门禁表覆盖新 S2.8，模块清单注释改为 library 2 端点实测。
- `docs/number-anchors.json`（新增）：`openstory.number-anchors/v1` 机器可读真源。
- `package.json`：新增 `arch:check`，避免 npm 吞掉 `--check`。
- `AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`docs/ACCEPTANCE.md`、`docs/LEGACY-ITEMS.md`、`docs/PUBLISHING.md`、`docs/plan/final-audit.md`、`docs/plan/workorder-system-20261124.md`、`docs/workorders/COMMON-RULES.md`、`docs/workorders/HANDOFF.md`：对齐当前数字、library 两个宿主域端点与行数口径；历史快照保留当时数字。

VERIFIED:
- `node tools/number-anchors.mjs` → 686 例 / 684 过 / 2 条件跳过 / 0 挂；JSON 回写成功。
- `node tools/acceptance/acceptance.mjs` → **25 过 / 0 挂 / 0 警**；S2.8 报 `686 例／门禁 25／端点 107／宿主域 2／app.js 11886≤11886 行`。
- `npm run arch:check` → 生成段与实测一致；`node --check` 五个改动 JS 文件全部通过。
- 反证 A：把 `docs/ACCEPTANCE.md` 测试数临时改为 687，`node tools/number-anchors.mjs --check` 退出 1，明确报 `docs/ACCEPTANCE.md 缺当前测试数：单测门禁（686 例`；已恢复。
- 反证 B：把上限序列临时改为 `[11886, 12000]`，同一检查退出 1，明确报 `app.js 行数上限只许下调，不许上调`；已恢复。
- 恢复后 `node tools/number-anchors.mjs --check` 再次全绿。

LIMITATIONS:
- 无。未改业务代码，未启动/杀 daemon，未碰真实库或真实本机院子，未执行 git 写操作。

## 验收记录（主 agent 填）

- 行数口径结论：`public/app.js` 为 CRLF、11,886 个物理行，其中 637 个空行；去掉空行恰好 11,249 行。差异不是 CRLF 或注释，统一采用生成表的物理行口径。
- 三处漂移已对齐：测试数 547→686；library 从“零端点”改为 `pinaxListGet` / `pinaxListImport` 两个端点；模块独占端点 41→43、覆盖 105/105→107/107；门禁 24→25。
- 当前数字：686 例、88 个测试文件、25 项门禁、107 个端点（43 模块独占＋64 宿主自有）、2 个宿主域端点、`app.js` 11,886 行。
- 2026-11-25 主 agent 独立验收通过；待作者统一提交后回填提交号。
