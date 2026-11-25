# OS-193 · 内核件归位与句柄化

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 6 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B6、B9；规划 §1.5「全程经底座路由，代码零直连」、§2.6 禁改区；ADR 0002 §一 目标 2 |
| 依赖 | OS-191 |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`tools/arch-stats.mjs`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-193-kernel-handles.md` |
| 风险 | **高**——动 fact 链与写通道；金样测试全程不许动，端点与落盘格式一个不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

七个内核件（`storage`、`fact`、`prose`、`text`、`deduce`、`agent-runtime`、`media`）名副其实：

- **K1 内核实现只有一个静态入口**——实现登记表。`src/**` 其余位置不许静态 import 内核模块内部实现。
- **K2 内核之间只经能力句柄**：在 `activate(context)` 里 `context.resolve(id)` 取句柄存进闭包，不静态 import 别的内核。
- **K3 内核的代码全部住在内核模块里**：`src/services/` 里属于内核件的部分搬进去。
- **K4 底座服务取内核能力靠传句柄**，不在模块顶层持有实现。

## 现状（监督线验收实测）

- `src/protocol/` 有 19 个转供叶，形如 `export * from '../modules/…'`；`api／services／host` 经它们直连内核实现的静态 import 有 38 条，模块之间 11 条。门禁报的「跨层直引 0」是按「只准经转供叶」的定义成立的。
- `src/services/` 里住着内核代码：`enrichEngine.mjs`（833 行）、`factBooks.mjs`、`factImportWrite.mjs`（属 fact）；`cli-bridge.mjs`、`dsh-bridge.mjs`、`chatUpstream.mjs`、`embedding-server.mjs`、`embeddingPaths.mjs`，以及 `agentConfig.mjs`、`dsh-cli.mjs` 两个两行垫片（属 agent-runtime）；`style-check.mjs`（属 text）。
- 内核直连内核：`src/modules/deduce/engine/` 下 7 个文件静态 import `protocol/factDomain.mjs`；`src/services/systemPrompt.mjs` 同时直连 fact、prose、世界书索引、storage。
- 能力路由只接到 handler 入口的少数几处（`resolveFactCapability` 等），停用一个内核件时其余路径照跑。

## 任务

### 1. 归位（K3）——等价搬家

把上面点名的文件搬进所属内核模块，**只移动位置、改 import 路径，函数体不改**。搬完后相应能力多暴露对应方法（如 `fact.enrich` 暴露富化运行、`agent.runtime` 暴露上游通道与 embedding、`text.analyze` 暴露 lint），写进各自的能力实现并补「转出不换实现」的测试（先例：`test/hostApi.test.mjs`）。

### 2. 内核之间只经句柄（K2）

`deduce` 引擎对 fact 词表的 7 处依赖改成：`deduce` 的 `activate(context)` 里 `context.resolve('fact.store')`／`fact.pack`，把句柄显式传给引擎函数；引擎函数不持有实现。依赖注入后的确定性测试（`test/deduceDeterminism.test.mjs` 8 例）必须原样全绿。

### 3. 底座服务靠传句柄（K4）

`systemPrompt.mjs`、`syncCheck.mjs` 这类跨内核的底座服务：函数签名显式接收能力句柄，由调用方在请求入口解析后传入（`resolve*Capability(root, id)`）。不在模块顶层 import 内核实现。调用方（`src/api/handlers/*`、`src/host/*`）本单先改成「入口取句柄、往下传」；handler 本体归插件是 OS-194 的事。

### 4. 转供叶减半

本单清掉属于内核件的转供叶：`factDomain.mjs`、`chapters.mjs`、`chapterWrite.mjs`、`text.mjs`、`agentRuntime.mjs`、`media.mjs`、`factStore.mjs`（并入实现登记表）。属于工作台内部与 storage 的（`referenceStore`、`worldbookContract`、`roleplayEngine`、`deduceSession`、`courtyard`、`habits`、`kb*` 等）留给 OS-195。

### 5. 门禁加一道（本单口径）

新增门禁 S2.11「内核直连」：`src/modules/{storage,fact,prose,text,deduce,agent-runtime,media}/**` 之间的静态 import＝0（只许经 `context.resolve`）；`src/services/**` 静态 import 内核实现＝0；`src/protocol/**` 不许再出现指向内核模块的 `export * from '../modules/…'`。`api` 与 `host` 对内核的直连本单只统计、列入台账，OS-194 清零。反证：临时在 `deduce/engine/` 里加一条对 fact 的静态 import，门禁红，贴输出后还原。

## 不做

- 不搬 handler（OS-194）；不动工作台内部与 storage 的转供叶（OS-195）。
- 不改端点、落盘格式、错误码、MCP 工具名；金样测试（`decoupleStep2`／`decoupleStep3`）一个字不动。
- 不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁全绿；红线测试 `test/decoupleStep2.test.mjs`、`test/decoupleStep3.test.mjs`、`test/deduceDeterminism.test.mjs`、`test/hostApi.test.mjs`、`test/kernelEnrich.test.mjs`、`test/factWriteProtocol.test.mjs` 全绿。
- 回报里贴静态 import 统计前后对比（内核↔内核、services→内核、protocol 转供叶、api／host→内核各多少条）。
- 任务 5 的反证贴输出；`git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
