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
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 817 · pass 815 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 新建：`src/modules/prose/factGuard.mjs`、`src/modules/agent-runtime/runtimeSidecar.mjs`
- 删除：`src/protocol/factGuard.mjs`、`src/protocol/upstream.mjs`、`src/protocol/index.mjs`、`src/protocol/embeddingBackend.mjs`、`src/protocol/runtimeShelf.mjs`
- 修改：`src/modules/prose/index.mjs`、`src/modules/prose/module.manifest.json`、`src/modules/chapters/handlers.mjs`、`src/modules/deduce/turnProse.mjs`、`src/modules/deduce/index.mjs`、`src/modules/deduce/module.manifest.json`、`src/modules/deduce/engine/factPort.mjs`、`src/modules/imagegen/imagegenEngine.mjs`、`src/modules/imagegen/index.mjs`、`src/modules/agent-runtime/index.mjs`、`src/modules/agent-runtime/chatUpstream.mjs`、`src/modules/agent-runtime/embedding-server.mjs`、`src/api/handlers/agent.mjs`、`src/host/daemon.mjs`、`src/host/mcp.mjs`、`src/host/authorize.mjs`、`src/protocol/shelfManifests.mjs`、`src/protocol/README.md`、`src/services/runtimes.mjs`
- 测试：`test/factGuard.test.mjs`、`test/hostApi.test.mjs`、`test/kernelIdentity.test.mjs`、`test/moduleCoverage.test.mjs`、`test/deduceEngine.test.mjs`、`test/deduceDeterminism.test.mjs`、`test/decoupleStep3.test.mjs`、`test/runtimes.test.mjs`、`test/agentRuntimes.test.mjs`、`test/artifacts.test.mjs`、`test/files.test.mjs`、`test/contracts.test.mjs`、`test/historyRetention.test.mjs`
- 门禁/工具/文档：`tools/acceptance/acceptance.mjs`、`tools/acceptance/capabilityBoundaries.mjs`、`tools/eval/eval-kbw.mjs`、`tools/eval/write-sample.mjs`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/number-anchors.json`

VERIFIED:
- `npm test`：817 例 / 815 过 / 2 跳 / 0 挂。红线批量复跑 110 例 / 109 过 / 0 挂；`node --test test/factGuard.test.mjs` 8/8；deduce 红线 31/31；runtime 红线 21/21。
- `node tools/acceptance/acceptance.mjs`：**28 过 / 0 挂 / 0 警**。S2.1 实测：`协议引登记表 0／协议跨层转供 0／登记表持有者 1（src/protocol/capabilityImplementations.mjs）`；协议清单 32 文件（登记 32）越界 0；跨模块 0、底座→工作台 0、实现复制 0。
- `node tools/number-anchors.mjs --check`：`✓ 数字锚一致：817 例／门禁 28／端点 103／app.js 10108≤10500`；`node tools/arch-stats.mjs --check`：`✓ 生成段一致`；`npm run arch:stats` 与 `node tools/number-anchors.mjs` 已回写。`git diff --check` 干净（仅 CRLF 提示）；`checkModuleActivation.mjs`：21 模块全激活、issues 0。
- `src/protocol/` 最终清单（32 个 .mjs）：agentEvents, apiErrors, authorize, baseCapabilities, capabilityGraph, capabilityImplementations, capabilityMigration, capabilityResolver, changelog, chapterNumber, contractHelpers, courtyard, deduceRules, dependencyGraph, hostWrite, httpText, kernelErrors, kernelPlumber, libState, libraryUpgrade, moduleActivation, moduleEntry, moduleIdentity, moduleManifest, modules, naming, plugins, rootPath, shelfManifests, slots, versionGate, worldbookContract。
- 登记表：`KERNEL_CAPABILITIES` 引用数 0（登记表自身除外），持有者仅 `src/protocol/capabilityImplementations.mjs`；`MODULE_IMPLEMENTATIONS` 仅由唯一解析绑定层 `src/host/capabilityBindings.mjs` 消费，不再有模块顶层持有。
- 反证输出（贴后已还原）：临时加 `_probe-leaf.mjs`（经登记表转出）与 `_probe-forward.mjs`（`export … from ../services/runtimes.mjs`）后 —— `✗ [S2.1] … OS-195b：协议引登记表 1／协议跨层转供 1／登记表持有者 2（…, src/protocol/_probe-leaf.mjs） — 违规：…_probe-leaf.mjs:2 -> capabilityImplementations.mjs：协议层不许经实现登记表取能力；…_probe-forward.mjs:2 -> src/services/runtimes.mjs：src/protocol 不许从 services/modules/public 转供`，`验收门禁：25 过 / 3 挂 / 0 警`；删除两文件后恢复 `28 过 / 0 挂 / 0 警`。
- 生产调用点（非仅测试）：`src/modules/chapters/handlers.mjs:30`（经 `prose.factHealth` 写前守卫）、`src/modules/prose/index.mjs:40-42`（注入 fact 句柄）、`src/modules/deduce/index.mjs:15-16` 与 `src/modules/deduce/turnProse.mjs:101-103,118-126`（对话通道句柄注入）、`src/modules/imagegen/index.mjs:14-23`（media.* 句柄装配）、`src/api/handlers/agent.mjs:89`（probeRuntimeKit/sidecarRunning 经句柄）、`src/host/daemon.mjs:565-566`（关停经能力解析）、`src/modules/agent-runtime/embedding-server.mjs:42`（直接 import 声明依赖）、`src/host/mcp.mjs:542`（分析经 resolveCapability）。对外端点/MCP 名/错误码/落盘格式未改；既有测试断言未删未放宽，仅增加句柄注入与等价能力面断言。

LIMITATIONS: 无
```

## 验收记录（监督线，2026-11-25）

- 提交 `b3342f8`；全量 817／815 过／2 条件跳过／0 挂；门禁 28／0／0；隔离 e2e 全绿。
- 监督线独立探针（不依赖施工方门禁）实测：
  - 实现登记表（`KERNEL_CAPABILITIES`）的全仓持有者只剩 `src/protocol/capabilityImplementations.mjs` 自身；`src/modules/deduce/engine/factPort.mjs` 不再留登记表兜底。
  - `src/protocol/index.mjs`（`host-api@2`）、`upstream.mjs`、`embeddingBackend.mjs`、`runtimeShelf.mjs` 已删除；`factGuard` 回到 `src/modules/prose/factGuard.mjs`。
  - 模块→别的模块静态 import 0；宿主→其它模块内部 0（只对两个宿主组合面放行 3 条）；protocol 清单与 `README` 逐一对上，做 I/O 的只有登记在册的 12 个。
  - `tools/eval` 两处失效 import 已指向 `src/modules/text/lint.mjs`。
- 结论：**已验收**。边界收口（OS-195、195a、195b 三单）至此完成。
