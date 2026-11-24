# OS-187 · D3 套件统一 manifest（三层货架升格）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 D 魔改批（可选；工作包 D3） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 创作套件、§2.2 suite 专属字段、§2.8、§3 R6／R7／R12、§4 批次 D |
| 依赖 | OS-186 |
| 允许改动 | `src/protocol/{plugins,suites,versionGate,dependencyGraph}.mjs`、`src/services/{suites,skills,runtimes,stylePacks,genres,suiteAssets}.mjs`、`src/host/**`、`src/api/**`、`public/views/**`、`suites/**`、`skills/**`、`styles/**`、`genres/**`、`runtimes/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中高（两套 manifest 体系合一，货架面广） |
| 状态 | 待派（可选批） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

三层货架（skills／styles／genres／runtimes／suites）从「各写各的 manifest、各走各的装载」升格为**同一套 manifest@2 的 suite 类**：`supplies`／`appliesTo`／`deps` 三个字段说清它供给什么、参数化哪个能力、依赖谁。此后「套件与模块同机制启停／覆盖／依赖闭包」。

## 主 agent 核对到的事实

货架实测：`skills/` 33、`suites/` 4、`runtimes/` 6、`styles/` 3、`genres/` 7（草案里写的 35 与 31＋2 与实测不符，以实测为准）。现有三套 spec：`openstory-suite@2`、`openstory-runtime-kit@1`，以及 skills／styles／genres 各自的格式；已有 `versionGate`（宿主版本闸）与 `dependencyGraph`（依赖环检测）可直接复用。

## 任务

1. **清单先行**：五层货架现有 manifest 的字段逐个列出，映射到 manifest@2 的 suite 字段（`supplies`／`appliesTo`／`deps`）——写一张对照表，拿不准的标出来。
2. **统一装载**：套件装载循环只认 manifest@2（suite 类）；`@1`／旧 spec 的货架条目经一次性迁移工具升版（只动仓内货架；**本机院子里的旧格式条目只读兼容一个大版本，不自动改写**）。
3. **`deps` 为软依赖**：缺依赖的套件整体不装载并提示（沿 `dependencyGraph` 的 blocked 语义），不产生断链。
4. **套件覆盖的边界**（R6）：suite 类的 `overrides` 只许是**资源覆盖**（按 id 替换资源，如文风包），不许改落盘格式、不许带 `migrations`——装载器遇到带迁移器的 suite 直接拒并报 `OVERRIDE_REJECTED`。
5. **不得携带可执行代码**：装载器检查 suite 目录里没有 `.mjs`／`.js` 可执行文件（数据驱动 DSL 允许；图灵完备脚本禁止——边界按 ADR）。现有的 `runtimes/`（CLI kit 带 `server.mjs`）怎么归类，按 ADR 结论处理并在报告里说明。
6. **前端**：设置·插件总览按三类分区展示套件；启停与模块同机制。
7. **测试**：五层货架全部过 suite 校验；依赖闭包（缺依赖不装载）；资源覆盖生效；带迁移器／带可执行代码的 suite 被拒。

## 不做

- 不改任何货架的内容（文风、体裁、技能文本本身）；不动 `samples/`。
- 不开放第三方动态装载（OS-188 只做评估）。

## 验收

- 全量测试与验收门禁全绿；覆盖面测试扩到套件（每个套件 N/N 有归属）。
- 报告贴：货架字段对照表、迁移工具输出的升版清单、`runtimes/` 的归类结论。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
