# OS-177 · B4 宿主域正名（agentbar／deduce／library 归位）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 B 能力批（工作包 B4） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.4、§4 批次 B |
| 依赖 | OS-174 |
| 允许改动 | `src/modules/*/module.manifest.json`、`src/protocol/**`、`src/api/**`、`public/views/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 低 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

三个「宿主域」模块（agentbar／deduce／library）在清单里有明确的归属与标识，不再卡在「既不算底座、也没被当成普通模块」的模糊地带。归位方向：agentbar → Agent 栏（工作台，`slots: ["sidebar"]`）；deduce → deduce 引擎件（内核件，供给 `deduce.engine`）；library → storage 件（内核件，供给 `storage.roots`／`library.list`）。

**本单只做标识与展示层的归位**；把它们的实现真正拆成内核件是 C3／C4／C5 的事。

## 任务

1. **`builtin` 字段**（按协议定稿）：这三份 manifest 标 `builtin: true`（随包自带、随版本升级，不从本机目录装载）；其余 11 份显式写 `builtin` 的实际值。
2. **清单分区**：`/api/plugins` 与覆盖面测试按 `class`（kernel／workbench／suite）分区；`test/moduleCoverage.test.mjs` 的宿主白名单里，凡是已经归位的条目移出白名单、改为有主（白名单只留真正的底座端点）。
3. **设置页与插件总览**：按新分区展示（内核件／工作台／创作套件三组），`builtin` 的带「内置」标。
4. **文档**：`ARCHITECTURE.md` 里宿主域「零端点零页签」一句改为实测的三模块归属表（OS-170 已把数字锚进门禁，这里补文字说明）。

## 不做

- 不改这三个模块的业务代码；不拆实现。
- 不动 `library` 的 `pinaxListGet`／`pinaxListImport`（若 OS-172 已退役则它们此时已不存在）。

## 验收

- 全量测试与验收门禁全绿；14 份 manifest 都有 `builtin` 与 `class`。
- 设置页三个分区截图留证（施工方无法开浏览器时，在报告里写明留给主 agent 验收）。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
