# OS-176 · B3 core 派生化（`core:true` 四件退役）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 B 能力批（工作包 B3） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.4、§2.3 停用推导、§4.1 S3 追认、§4 批次 B |
| 依赖 | OS-175 |
| 允许改动 | `src/host/**`、`src/protocol/**`、`src/api/**`、`src/modules/*/module.manifest.json`、`public/views/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

「核心插件保底」不再靠手写的 `core: true`，而是**由能力图推导**：底座声明自己 requires `prose.write` 等通道，谁供给这些通道谁就自动不可停。`MODULE_CORE` 语义随之退役；停用一个被依赖的模块，报错能讲清楚「谁会跟着坏」。

## 背景

现行核心集合 chapters／worldbook／script／roleplay 已于规划 §4.1 追认，理由是「core 语义＝底座自举依赖」。本单把这层语义从标记变成推导。

## 任务

1. **底座持有 `requires`**：把「底座自举依赖」写成一份只读清单（按 ADR 结论：至少 `prose.write`、`fact.store`，worldbook／roleplay 是否在列由 ADR 定）。
2. **四份 manifest 去掉 `core: true`**；`MODULE_CORE` 的产生点与契约登记退役（保留一个版本的只读兼容：读到旧字段忽略并记一条启动警告）。
3. **不可停用由推导产生**：停用 chapters 的请求 → 能力图发现底座 requires `prose.write`、写作台与剧本台也 requires 它 → 409，错误体列出全部受影响消费者。四条证据（恒启用／拒写／页签在／端点通）改写为推导版测试。
4. **前端**：设置·模块组里「核心模块」锁定徽标改为「被 N 处依赖，不可停」（悬停列受影响者）；没有任何依赖的模块正常可停。
5. **文档**：`AGENTS.md` 硬规则里的「核心四模块」表述改为「底座 requires 推导」；`ARCHITECTURE.md` 同步；`docs/LEGACY-ITEMS.md` 补一条已裁定。

## 不做

- 不改任何模块的业务行为；不改 Host API 形状。
- 不动 `pages[].slot` 与页签注册表。

## 验收

- 全量测试与验收门禁全绿；覆盖面测试里「`core:true` 恰好四个」的断言改为「底座 requires 的每个能力都有供给者且不可停」。
- 反证：停用 chapters 与停用一个无依赖模块，两种结果的错误体各贴一份。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
