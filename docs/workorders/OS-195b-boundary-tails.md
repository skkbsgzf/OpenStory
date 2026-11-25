# OS-195b · 边界收口返工（二）：经 protocol 绕行的小尾巴一次收干净

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-195a（`2e17198`） |
| 对应 | OS-195a 验收记录「余项」；COMMON-RULES 第 11 条（只有测试在调的不算实现） |
| 依赖 | OS-195a |
| 允许改动 | `src/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-195b-boundary-tails.md` |
| 风险 | 中——都是小件，但动的是能力入口；对外契约一个不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 现状（监督线探针实测，OS-195a 之后）

主体已经对了：`src/protocol/` 5,975 行、模块空壳 0、跨模块静态 import 0、`src/services/` 七个底座服务、钩子贡献到位。剩下的是同一手法的几处小尾巴——逻辑仍经 `src/protocol/` 绕一下，躲开门禁的口径：

1. `src/protocol/factGuard.mjs`（263 行）：FACT-FIRST 写前守卫，只有 `src/modules/chapters/handlers.mjs` 在用；它在 protocol 里经实现登记表取内核能力，并直接读 fact 文件。
2. `src/protocol/upstream.mjs`：把 `agent.runtime` 的对话通道经登记表转出；唯一使用方是内核 `src/modules/deduce/turnProse.mjs`——内核→内核没走句柄。
3. `src/protocol/index.mjs`（241 行，`host-api@2`）：第二套能力入口，**只有 `test/hostApi`、`test/kernelIdentity`、`test/moduleCoverage` 三个测试文件在用**，没有生产调用方。
4. `src/protocol/embeddingBackend.mjs`：把 `@xenova/transformers` 的裸包名 import 挪到 protocol，好让模块过「不许裸包名」的门禁。
5. `src/protocol/runtimeShelf.mjs`：从 `src/services/runtimes.mjs` 转供 `loadRuntimeKits`／`probeRuntimeKit`／`ensureSidecar` 给 agent-runtime 内核。
6. 在模块顶层持有实现登记表（`KERNEL_CAPABILITIES`）的还有：`src/modules/imagegen/imagegenEngine.mjs`、`src/host/daemon.mjs`、`src/host/mcp.mjs`；`src/modules/deduce/engine/factPort.mjs` 留着登记表兜底。
7. 两处失效 import：`tools/eval/eval-kbw.mjs:19`、`tools/eval/write-sample.mjs:13` 仍指向已删除的 `src/services/style-check.mjs`。

## 任务

1. **`factGuard` 回内核**：搬进 `src/modules/prose/`（写前守卫是 `prose.write` 的一部分）；读事实经 `fact.store`／`fact.pack` 句柄；chapters 的 handler 经 `prose.write` 句柄调用。`test/factGuard.test.mjs` 的断言等价迁到能力面，不删不放宽。
2. **`upstream.mjs` 删除**：`deduce` 在 `activate(context)` 里 `context.resolve('agent.runtime')`，把对话通道显式传给 `turnProse`。
3. **`host-api@2` 退役**：`src/protocol/index.mjs` 删除；三个测试文件里对它的断言改成对能力句柄与实现登记表的等价断言——键清单快照迁到能力面，「转出不换实现」的保护不许丢。`KERNEL_ID` 等身份常量若有生产用途，落到 `src/kernel/`。
4. **`embeddingBackend.mjs` 删除**：门禁的「模块只许 node: 与仓内相对说明符」改为「node: 内置、`package.json` 的 `dependencies` 里声明的包、仓内相对说明符」——门禁显式读 `package.json`，不写白名单。agent-runtime 内核直接 import 它声明的依赖。
5. **`runtimeShelf.mjs` 删除**：运行时 kit 的 sidecar 生命周期与探活（`ensureSidecar`、`probeRuntimeKit`、sidecar 状态）搬进 `src/modules/agent-runtime/`；`src/services/runtimes.mjs` 只留清单装载。
6. **登记表只剩一个持有者**：`imagegenEngine.mjs` 经 `context.resolve('media.*')`；`host/daemon.mjs`、`host/mcp.mjs` 经 `resolve*Capability(root, …)`；`deduce/engine/factPort.mjs` 不留登记表兜底——句柄没注入就明确报错。
7. **门禁再加三条**（`tools/acceptance/capabilityBoundaries.mjs`）：
   - `src/protocol/**` 里 import 实现登记表的文件数＝0（登记表自身除外）；
   - `src/protocol/**` 不许从 `src/services/**`、`src/modules/**`、`public/**` 转供（任何 `export … from`）；
   - 全仓在模块顶层持有实现登记表的文件只许是登记表自身。

   反证两则，贴输出后还原：(a) 临时加一个经登记表转出能力的 protocol 叶子；(b) 临时在 `src/protocol/` 里写一句 `export { x } from '../services/…'`。
8. 修两处 tools 的失效 import（指向 `src/modules/text/lint.mjs`）。
9. `src/protocol/README.md` 同步；`ARCHITECTURE.md` 与数字锚回写。

## 不做

- 不改任何对外契约（端点、MCP 工具名、错误码、落盘格式）；金样测试一个字不动。
- 不碰作者真库与真实 `%LOCALAPPDATA%`；不许靠加白名单过关。

## 验收

- 机器门禁全绿；红线测试 `test/factGuard.test.mjs`、`test/decoupleStep2.test.mjs`、`test/decoupleStep3.test.mjs`、`test/deduceDeterminism.test.mjs`、`test/handlerDispatch.test.mjs`、`test/agentRuntimes.test.mjs`、`test/runtimeShelf.test.mjs`、`test/hostApi.test.mjs`（或其接替文件）全绿。
- 回报里贴：`src/protocol/` 最终清单；登记表引用数与持有者清单（应各自只剩登记表自身）；三条新断言的实测数字与两则反证输出。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
