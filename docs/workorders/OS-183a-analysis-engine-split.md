# OS-183a · C5b 分析引擎拆分（纯引擎→内核件能力；分析台→工作台）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（规划新增件，**视 A2 是否采纳 R3 而生效**） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §3 R3、§4 批次 C |
| 依赖 | OS-173（ADR 对 R3 有结论）且结论为「拆」；施工排在 OS-183 之前 |
| 允许改动 | `src/modules/analysis/**`、`src/modules/prose/**`、`public/analysis*.mjs`、`public/charts.mjs`、`public/graph.mjs`、`public/views/**`、`src/api/**`、`src/host/mcp.mjs`、`src/modules/{analysis,roleplay,habits,chapters}/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中 |
| 状态 | **待 A2 裁定**（ADR 若驳回 R3，本单作废并在看板注明） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

草案把 analysis 并成「分析台（工作台）」。但分析引擎是一组纯函数，同时被**服务端**消费：MCP 的分析工具、扮演成文的去 AI 味闸（`roleplayEngine → public/analysis`，现靠门禁豁免活着）、习惯 lint。内核件依赖工作台是倒挂。所以拆成两层：**纯引擎**作为内核件能力（如 `prose.analyze@1`，归 prose 件或单列一件，按 ADR），**分析台**只是消费它的 UI。

## 任务

1. **引擎归位**：`public/analysis.mjs` 的纯函数部分落为服务端可经能力路由取用的模块（浏览器侧仍经动态 `import()` 取同一份——零构建下前后端共享纯模块是既有做法）；manifest 声明能力。
2. **服务端消费方改接**：MCP 分析工具、扮演的去 AI 味闸、习惯 lint 三处改为 `resolve('prose.analyze')`；门禁里 `roleplayEngine → public/analysis` 的豁免随之删除（**门禁只增不减：删豁免＝变严**）。
3. **分析台**：analysis＋charts／graph 合并为工作台，`requires` 该能力，`slots: ["tab"]`；前端入口不变。
4. **测试**：引擎输出的金样（固定文本→固定指标）；三处服务端消费方改接后行为不变。

## 不做

- 不改分析引擎的任何算法与阈值；不改分析面板的用户可见行为。

## 验收

- 全量测试与验收门禁全绿；豁免台账里那条边已删除且门禁仍绿。
- 报告贴：引擎能力契约（句柄形状）、三处改接的前后对照。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
