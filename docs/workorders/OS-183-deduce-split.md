# OS-183 · C5 deduce 三拆（引擎件＋推演规则包＋扮演台门面）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（工作包 C5） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 deduce 件与推演规则包、§1.5、§3 R10、§4 批次 C |
| 依赖 | OS-182 |
| 允许改动 | `src/modules/deduce/**`、`src/modules/roleplay/**`、`suites/**`、`src/protocol/**`、`src/host/**`、`src/api/**`、`src/modules/{deduce,roleplay}/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中高（推演是产品引擎，行为必须逐拍不变） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

roleplay 与 deduce 两个模块拆成三样东西：**deduce 引擎件**（确定性执行器：会话／回合／结算／多局，供给 `deduce.engine@1`）、**推演规则包**（创作套件，供给 tool：2d6／局面卡／候选模板——规则不进引擎）、**扮演台**（工作台门面：页面、端点、视图）。换一套规则包＝换一种玩法，引擎一行不改。

## 任务

1. **规则析出**（先盘后动）：把 `src/modules/deduce/engine/**` 里属于「玩法参数」的部分（骰子规格、局面卡模板、候选生成模板、命运档位文案）与属于「执行器机制」的部分分开，列一张「引擎保留／规则析出」清单。析出的规则落成内置套件 `suites/推演规则包/`（数据，不含可执行代码——数据驱动 DSL 允许、图灵完备脚本禁止，按 ADR 边界）。
2. **引擎件读规则**：执行器从 `appliesTo: deduce.engine` 的已装载套件取规则参数；没有规则包时用内置缺省包。
3. **确定性测试绑缺省规则包**（R10）：「同种子＋同事实包＝同一拍」在缺省规则包下照绿；另加一条「换规则包＝新金样」的测试（第二套规则包下同样可复现）。
4. **扮演台门面**：`src/modules/roleplay/` 只留页面、端点归属与视图；manifest `class: workbench`，`requires` 三项（`deduce.engine`、`agent.runtime`、`fact.store`），`slots: ["tab"]`。
5. **`roleplayEngine → public/analysis` 的依赖**：按 OS-183a 的结论处理（若 183a 已把纯引擎拆成内核件能力，这里改接；若 183a 未做，保留现状并在报告里注明）。
6. **测试**：三拆前后同一会话的推演产出逐字节一致（迁移前后对比）；停用规则包 → 引擎回落缺省包且提示；规则包含可执行代码时被装载器拒绝。

## 不做

- 不改推演的落盘格式（会话文件、多局、归档）；不改扮演页的用户可见行为。
- 不动前端视图（扮演页视图已在 OS-164 迁出）。

## 验收

- 全量测试与验收门禁全绿；确定性测试两类都绿。
- **换玩法演练**：装一套只有数据的不同规则包（例如把 2d6 换成另一组骰子规格），出一拍，结果与缺省包不同且可复现；引擎代码零改动（`git diff` 证明）。
- 报告贴：引擎保留／规则析出清单、迁移前后产出对比的哈希。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
