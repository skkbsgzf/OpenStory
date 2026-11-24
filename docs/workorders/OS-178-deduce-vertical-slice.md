# OS-178 · B5 deduce 垂直切片（生态耦合第一条显式链路）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 B 能力批（工作包 B5） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.5、§2.6、§4 批次 B |
| 依赖 | OS-175（能力图与路由已就位） |
| 允许改动 | `src/api/**`、`src/modules/deduce/**`、`src/modules/chapters/module.manifest.json`、`src/modules/roleplay/**`、`src/protocol/**`、`src/host/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（动推演的调用链，行为必须逐拍不变） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

打通**第一条经能力路由的显式耦合链路**，证明「工作台 requires 内器件、零代码耦合」不是口号：`src/api/handlers/fact*` 不再直接 import 推演引擎，而是 `resolve('deduce.engine')` 取句柄；写作台要接推演（分支联动）只需在 manifest 里写一行 `requires`。

## 任务

1. **deduce 供给 `deduce.engine@1`**：`src/modules/deduce/` 的 manifest（@2）声明该能力；引擎目录（`engine/`）的导出面作为能力句柄的形状，写进协议文档的能力契约小节。
2. **消费方改接**：所有直接 import `src/modules/deduce/engine/**` 的调用点（`src/api/handlers/fact*`、`src/api/handlers/system*` 等，先 grep 列清单）改为经路由取句柄。**路由句柄是薄代理**（OS-175 已提供），本单禁止退化成函数引用。
3. **写作台声明依赖**：写作台（chapters 的页面半）manifest 加 `requires: [{ id: "deduce.engine", min: 1 }]`——只为演示「分支联动＝一行声明」；若写作台此刻并没有真的调用推演，就加一个最小的只读入口（例如在章节菜单里能拿到「本拍局面」），不要造假调用。
4. **门禁 S2.1 跟上**：把「handlers 不得 import 引擎内部实现」写成规则（现有 S2.1 的三层路径规则是它的前身）；本单先只覆盖 deduce 这一条链路，全面改写留给 OS-184。
5. **测试**：链路测试——停用 deduce 供给（若被依赖则应被拒并点名消费方）；缺供给时消费方不装载并报 `PLUGIN_DEGRADED`；**确定性测试照绿**（同种子＋同事实包＝同一拍，证明路由没有改变行为）。

## 不做

- 不拆引擎与规则（OS-183）；不改推演的行为与落盘格式。
- 不把其它内核件（fact／prose／storage／agent.runtime）改接（C 批）。

## 验收

- 全量测试与验收门禁全绿；确定性测试逐例绿。
- `grep -rn "modules/deduce/engine" src/api` 为空（或只剩经路由的间接引用）。
- 反证：把 deduce 的供给从 manifest 里临时拿掉，启动报告必须列出哪些消费方因此降级；贴输出后改回。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
