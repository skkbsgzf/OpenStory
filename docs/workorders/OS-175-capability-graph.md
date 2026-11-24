# OS-175 · B2 能力图检查器（闭环／冲突／覆盖合法）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 B 能力批（工作包 B2） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §2.3、§2.7、§3 R4／R5／R7／R8、§4 批次 B |
| 依赖 | OS-174 |
| 允许改动 | `src/host/**`、`src/protocol/**`、`src/api/**`、`src/modules/*/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

底座启动时**构建能力图并当裁判**：谁的依赖没着落、谁和别人抢同一个能力、谁的覆盖声明不合法——启动报告一次说清。「有依赖的供给者不可停」从此由推导产生，不再靠手写标记。

## 任务

1. **构建能力图**：扫全部已装载 manifest 的 `capabilities`／`requires`／`overrides`，建「能力 id＋主版本 → 供给者」「消费者 → 所需能力」两张表。能力 id **不写死在底座**：由供给者声明、启动时登记进词表（底座只固定它自己那几个能力 id）。
2. **三项检查**（按定稿与 ADR 的结论）：
   - 闭环：每条 `requires`（含底座自身的那份）都有可用供给者，否则 `CAPABILITY_MISSING`，报告列出每条断链（消费者 ← 缺失能力）；
   - 冲突：同一能力多个供给者且互相无覆盖关系 → `CAPABILITY_CONFLICT`，点名供给者；
   - 覆盖合法：`overrides` 的 target 存在、`from` 与被覆盖者当前主版本一致、改落盘格式的带迁移器 → 否则 `OVERRIDE_REJECTED`。
3. **启动失败策略**（ADR 结论；建议：底座永远能起）：检查不过时，缺能力的插件**不装载**并在启动报告里列出；`/api/health` 与一个启动报告端点照常可用。
4. **停用的两种语义分开**：
   - 停用被拒：有人要停一个被依赖的供给者 → 409，错误体列出全部受影响的消费者；
   - 消费者降级：启动时供给者缺席 → 该消费者不装载并报 `PLUGIN_DEGRADED`。
5. **能力路由表**：检查通过后冻结；`resolve(capabilityId)` 返回**薄代理**句柄（可拦截、可热替换——D1 的回退链要用）。本单只提供路由与句柄，消费方改接是 OS-178 及 C 批的事。
6. **错误码登记**：`CAPABILITY_MISSING`、`CAPABILITY_CONFLICT`、`OVERRIDE_REJECTED`、`PLUGIN_DEGRADED` 与停用被拒的码，进契约 errors 与 HTTP 映射表。
7. **测试**（`test/capabilityGraph.test.mjs`）：断链／冲突／非法覆盖各一例；停用被拒列断链；无依赖供给者可停；启动报告内容；路由句柄可取到正确供给者；能力 id 由供给者登记（第三方新增能力不需要改底座）。

## 不做

- 不把任何现有消费方改接到能力路由（OS-178 起才有第一条）。
- 不动 `core: true`（OS-176）。

## 验收

- 全量测试与验收门禁全绿（现有 14 份 manifest 在新检查器下**必须全部通过**——若通不过，说明某条 `requires` 没人供给，如实上报而不是放宽检查）。
- 反证：临时把某份 manifest 的 `requires` 指向一个不存在的能力，启动报告必须点名这条断链；贴输出后改回。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
