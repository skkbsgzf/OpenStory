# OS-179 · C1 fact 插件化（fact 链出底座）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（工作包 C1） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 内器件、§1.6 重组红利、§4 批次 C |
| 依赖 | OS-174、OS-175、OS-178（能力路由已有第一条链路可照抄） |
| 允许改动 | `src/kernel/**`、`src/modules/fact/**`（新建）、`src/protocol/**`、`src/host/**`、`src/api/**`、`src/modules/*/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 高（fact 是全仓数据底座） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

`src/kernel/` 里的 fact 链（`fact/`、`enrich/`）不再是「底座的一层」，而是**平级的内核件 fact**，供给 `fact.store@3`、`fact.pack@1`、`fact.enrich@1`；金样随能力走；底座只留物理写管道与 errors 词表（后者进契约壳）。

## 任务

1. **迁出**：`src/kernel/fact/**`、`src/kernel/enrich/**` → `src/modules/fact/`；manifest 声明三项能力（`fact.store` 带 `golden`）；`src/kernel/` 只剩 `atomicWrite.mjs`、`fsDurability.mjs`、`identity.mjs` 与出口。
2. **消费方改接**：所有经 Host API `fact.*` 取能力的调用点（handlers／factGuard／enrichEngine／worldbook／deduce／exchange）改为 `resolve('fact.store')` 等；Host API `@2` 的 `fact` 命名空间随之收缩为纯底座面（`ok`／`fail`／`writeFileAtomic`），版本号按定稿处理（破坏性变更需升 `@3`）。
3. **金样随能力走**：`test/decoupleStep2.test.mjs` 等锁落盘格式的测试文件迁到 `src/modules/fact/` 旁边（或 `test/golden/fact.*`），manifest 的 `golden` 字段指向它。
4. **v4 演练**（验收核心）：用一个假想的 `fact.store@4` 供给者（测试夹具，不进产品代码）覆盖旧件——带迁移器与新金样——证明「动内核＝换一个平级件，底座一行不动」。迁移器框架此时尚未落地（OS-186），演练里用一个最小手写迁移器即可。
5. **门禁**：S2.4′（内核实现唯一）改为「底座边界」——`src/kernel/**` 只许含物理写管道与身份常量；「`src/**` 不许直 import 内核件内部」扩到 fact。

## 不做

- 不改 fact 的落盘格式与写协议；不动 `factGuard` 的只读语义。
- 不做真正的 `@4`（只是演练）。

## 验收

- 全量测试与验收门禁全绿；fact 相关金样全绿且随能力迁移到位。
- v4 演练输出：覆盖后 `resolve('fact.store')` 拿到 v4、迁移器跑通、新金样绿、撤掉覆盖自动回到 v3。
- 报告贴：`src/kernel/` 的最终清单、改接的调用点清单。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
