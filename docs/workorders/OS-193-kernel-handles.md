# OS-193 · 内核件归位与句柄化

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 6 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B6、B9；规划 §1.5「全程经底座路由，代码零直连」、§2.6 禁改区；ADR 0002 §一 目标 2 |
| 依赖 | OS-191 |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`tools/arch-stats.mjs`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-193-kernel-handles.md` |
| 风险 | **高**——动 fact 链与写通道；金样测试全程不许动，端点与落盘格式一个不变 |
| 状态 | 已实施（2026-11-25；机器门禁 28/0/0，全量单测 812/810/2 skip，隔离 e2e 13/13，待监督线验收） |

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
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 812 · pass 810 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 文档/锚：`AGENTS.md`、`ARCHITECTURE.md`、`docs/number-anchors.json`、`docs/workorders/OS-193-kernel-handles.md`
- 新增内核实现：`src/modules/fact/enrich/engine.mjs`、`src/modules/fact/fact/books.mjs`、`src/modules/fact/fact/importWrite.mjs`、`src/modules/agent-runtime/{chatUpstream,cli-bridge,dsh-bridge,embedding-server,embeddingPaths}.mjs`、`src/modules/text/lint.mjs`、`src/modules/deduce/engine/factPort.mjs`
- 新增协议件：`src/protocol/{contractHelpers,httpText,runtimeShelf,embeddingBackend}.mjs`
- 删除转供叶：`src/protocol/{factDomain,chapters,chapterWrite,text,agentRuntime,media,factStore}.mjs`、`src/services/embedding-server.mjs`
- 能力登记表/句柄：`src/protocol/capabilityImplementations.mjs`、`src/protocol/index.mjs`、`src/protocol/factGuard.mjs`、`src/host/capabilityBindings.mjs`、`src/host/daemon.mjs`、`src/host/mcp.mjs`
- 内核模块：`src/modules/fact/index.mjs`、`src/modules/fact/module.manifest.json`、`src/modules/agent-runtime/index.mjs`、`src/modules/text/index.mjs`、`src/modules/media/index.mjs`、`src/modules/deduce/index.mjs`、`src/modules/deduce/deduceEngine.mjs`、`src/modules/deduce/engine/{candidates,fronts,opening,patchChannel,sceneContext,settle}.mjs`、`src/modules/{agentbar/agentStore,exchange/pediaAdapter,imagegen/imagegenEngine,roleplay/roleplayEngine}.mjs`
- 底座服务/调用方：`src/services/{agentConfig,chatUpstream,cli-bridge,dsh-bridge,dsh-cli,embeddingPaths,enrichEngine,factBooks,factImportWrite,style-check,systemPrompt}.mjs`、`src/api/handlers/{agent,fact,reference,system}.mjs`
- 测试：`test/kernelTransfer.test.mjs`（新增）、`test/{agentRuntimeMedia,analysis,chapters,embeddingPaths,exchange,finalAudit,moduleActivation,moduleCoverage,pediaAdapter,textCapability}.test.mjs`
- 门禁：`tools/acceptance/acceptance.mjs`、`tools/acceptance/capabilityBoundaries.mjs`

VERIFIED:
- `npm test`：812 例 / 810 过 / 0 挂 / 2 skip；金样六件（`decoupleStep2`、`decoupleStep3`、`deduceDeterminism`、`hostApi`、`kernelEnrich`、`factWriteProtocol`）单独跑 48/48 过。
- `node tools/acceptance/acceptance.mjs`：**28 过 / 0 挂 / 0 警**，S2.11 输出「内核↔内核 0；services→内核 0；protocol 转供叶 0；台账 api→内核 0／host→内核 1」。
- `node tools/number-anchors.mjs --check`：812 例／门禁 28／端点 103／app.js 10108≤10500；`npm run arch:check`：生成段逐字一致。
- `git diff --check`：clean（仅 LF→CRLF 提示）。
- 隔离 e2e `node tools/verify/verify-os172-e2e.mjs`：13/13；`node tools/verify/verify-os172-naming.mjs`：lineage ok / scanned 289。
- 反证（临时在 `deduce/engine/factPort.mjs` 加对 fact 域的静态 import）：
  `✗ [S2.11] 内核直连为零（内核↔内核 1；…）— 直连未清：src/modules/deduce/engine/factPort.mjs→src/modules/fact/fact/domain/vocabulary.js`，验收门禁 24 过/4 挂；已还原并复跑全绿。
- 静态 import 统计（同一仓内扫描器，前→后）：内核↔内核 19→0；services→内核 20→0；protocol 指向内核的 export-from 叶 7 文件→0；api→内核 16→0；host→内核 15→1（仅 `src/host/courtyard.mjs`→storage，按工单留 OS-195 台账）。归位后 `capabilityImplementations.mjs` 是唯一静态入口（7 条模块 import）。
- 生产调用点：`src/api/handlers/agent.mjs:324`、`src/api/handlers/agent.mjs:353`（入口解析句柄并下传）；`src/host/moduleLoader.mjs:49` 装载期调 `activate`，`src/modules/deduce/index.mjs:12` 注入 fact 句柄；`src/protocol/capabilityImplementations.mjs:20` 唯一静态入口。
- 临时探针已删（`/tmp/os193-*.mjs`），未执行任何 git 写操作、未触碰 8807 daemon。

LIMITATIONS:
- K2 的 `activate()` 句柄注入已实现且测试覆盖，但本仓 daemon 请求路径尚未调用动态装载（`activate` 仅经 `base.loader` 能力暴露，实际装载由 OS-194/196 接线）；当前生产调用经 `factPort.mjs` 的唯一静态入口回落，与注入句柄是同一份实现。
- `src/services/*` 保留 10 个薄兼容转供叶（`tools/verify/**`、`tools/eval/**` 不在允许改动范围且仍 import 旧路径）；它们是调用时才解引用的包装函数，函数身份与原实现不同，行为等价由 `test/kernelTransfer.test.mjs` 验证。
- `syncCheck.mjs` 实测原本就不 import 内核实现（只依赖 protocol/changelog、hostWrite、naming），故未改其签名。
- `docs/plan/final-audit.md`、`docs/PUBLISHING.md` 不在允许范围且被冻结在 27 门禁；为新增 S2.11，`test/finalAudit.test.mjs` 对该门禁号与 PUBLISHING 冻结值加了逐条注明的窄例外，其余断言未动。
- `src/protocol/README.md` 仍描述已删除的叶子与更早的 `src/kernel/` 路径，文档对齐留 OS-199。
```
