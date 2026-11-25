# OS-195a · 边界收口返工（一）：把倒过来的转供改回去＋归属与消费路径

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-195（`50dccae`，监督线判返工） |
| 对应 | OS-195 的 R-b／R-d 未达；验收记录见 OS-195 文末 |
| 依赖 | OS-195（`50dccae`） |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`tools/arch-stats.mjs`、`ARCHITECTURE.md`、`docs/number-anchors.json`、`AGENTS.md`、`src/protocol/README.md`、`docs/workorders/OS-195a-boundary-rework.md` |
| 风险 | **高**——动的是模块归属与分派主干；对外契约一个不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 为什么返工（监督线验收实测）

OS-195 让四条规则变绿的办法是**把转供方向倒过来**：实现从模块搬进 `src/protocol/`，模块文件变成只从 protocol 转供的空壳。

- 现在住在 `src/protocol/` 里的业务实现：`agentStore`（483 行，读写文件）、`deduceSession`（494 行，读写文件）、`knowledgeAdapter`／`knowledgeHealth`／`knowledgeRouter`（共 536 行，其中 `knowledgeHealth` 起子进程、`knowledgeRouter` 发网络请求）、`importAdapter`（587 行）、`libraryInventory`（190 行）、`habits`（117 行）、`referenceStore`（612 行）。
- 变成空壳的模块文件有 13 个（`agentbar/agentStore`、`deduce/deduceSession`、`habits/habits`、`knowledge/*` 三个、`library/{importAdapter,inventory,textUtil}`、`storage/courtyard`、`worldbook/{referenceStore,worldbookFileContract}`、`agent-runtime/credentials`），每个 5～7 行，只有一句 `export … from '../../protocol/…'`。
- 跨模块的真实使用还在：`roleplay/handlers`、`imagegen/handlers` 用 `protocol/deduceSession`；`imagegen/handlers` 用 `protocol/referenceStore`；`artifacts/handlers` 用 `protocol/libraryInventory`——只是改从 protocol 拿，门禁量不到。
- `src/services/` 里还留着 10 个内核兼容叶（`enrichEngine`、`factBooks`、`factImportWrite`、`chatUpstream`、`cli-bridge`、`dsh-bridge`、`dsh-cli`、`agentConfig`、`embeddingPaths`、`style-check`），R-d「只留底座服务」没达到。

## 本单立规矩（写进 AGENTS.md，下一张单进门禁）

- **归属**：模块自己的实现住在自己的目录里。`src/protocol/` 只放底座契约——纯函数，或只读的路径／形状／词表／校验逻辑；做 I/O 的只许三个登记在册的例外（写管道 `hostWrite`、留痕管道 `changelog`、旧库一次性升级 `libraryUpgrade`、迁移 journal `capabilityMigration`、院子目录确保 `courtyard`）。
- **消费路径**（谁要用别人模块的东西，只有下面四条路）：
  1. 内核件的东西 → 能力句柄（`context.resolve(id)`）。
  2. 宿主组合面（`agentbar`、`library`）的东西 → 只有宿主可以直接 import；别的模块要用，走端点分派。
  3. 工作台要给宿主（含 Agent 栏）东西 → 经 `activate()` 贡献**钩子**，宿主按库快照取（模块停用＝钩子消失）。
  4. 工作台要用别的工作台的东西 → 经底座的端点分派（`handlerFor(endpointId, root)`），不 import 对方内部。

## 任务

### 1. 搬回模块（等价搬家：只移动位置、改 import 路径，函数体不改）

| 现在 `src/protocol/` 里 | 搬去 |
|---|---|
| `agentStore.mjs` | `src/modules/agentbar/` |
| `deduceSession.mjs` | `src/modules/deduce/` |
| `habits.mjs` | `src/modules/habits/` |
| `knowledgeAdapter.mjs`、`knowledgeHealth.mjs`、`knowledgeRouter.mjs` | `src/modules/knowledge/` |
| `importAdapter.mjs`、`libraryTextUtil.mjs` | `src/modules/library/` |
| `libraryInventory.mjs` | `src/modules/storage/`（库内文件盘点是通用的只读能力，登记为 `storage.inventory@1`） |
| `referenceStore.mjs` | `src/modules/worldbook/` |
| `agentCredentials.mjs` | `src/modules/agent-runtime/`（凭据本就在 `agent.runtime` 能力面里） |

删掉只做转供的空壳文件与 `src/protocol/libraryImport.mjs`（宿主直接用 `src/modules/library/`）。**留在 protocol 的**：`worldbookContract.mjs`（942 行纯函数，世界书落盘格式契约）、`courtyard.mjs`（装载任何模块之前就要知道院子在哪）。两者在 `src/protocol/README.md` 登记。

### 2. 逐条改消费路径（回报里每条写清走了哪条路）

- `roleplay`、`imagegen` → `deduceSession`：走能力句柄；`deduce` 的能力面补齐会话读写所需方法。
- `imagegen` → `referenceStore`（往世界书条目存图）：走世界书的端点分派。
- `artifacts` → `libraryInventory`：走 `storage.inventory` 句柄；库管理（`library`）与宿主 `system` 端点同样。
- 宿主对习惯的两处使用（写前 lint、提示词里的习惯表——现在在 `src/host/moduleHooks.mjs`）与对知识库的使用（提示词里的先例片段 `precedentPromptSectionForGenre`）、对世界书笔记的读取（Agent 上下文）：**改成钩子贡献**。
  - `CONTRIBUTION_KEYS` 增加钩子键；钩子名登记在底座（如 `beforeWrite`、`promptContext`），未登记的钩子名拒收。
  - 宿主经贡献表取钩子（与 `handlerTable` 同一套按库快照换表的机制）；`src/host/moduleHooks.mjs` 并入，不留第二套注册方式。
  - `api/handlers/reference.mjs` 里剩下的端点：属于世界书功能的，搬进世界书模块的 `handlers.mjs`（manifest 的 `endpoints` 同步，端点数不变）；不属于的，说明它为什么不带世界书逻辑。
- `agentbar` 对凭据的使用走 `context.resolve('agent.runtime')`。
- 宿主 handler（`api/handlers/{agent,fact,reference,system}.mjs`）对内核的使用：改经 `resolve*Capability(root, …)` 句柄；`src/services/` 的 10 个内核兼容叶删除（`embeddingPaths`、`style-check` 已无产品代码引用，直接删并修测试与工具的 import）。`src/services/systemPrompt.mjs` 不再在模块顶层持有任何实现引用。

### 3. `src/services/` 的终态

只留七个底座服务：货架装载五个（`genres`、`runtimes`、`skills`、`stylePacks`、`suites`）＋ `systemPrompt`、`syncCheck`。回报里贴目录清单。

### 4. 门禁（`tools/acceptance/capabilityBoundaries.mjs`）

在 OS-195 的新口径上补三条，缺一门禁就是假的：

- **模块不是壳**：`src/modules/**` 里不许有「只从 `src/protocol/` 转供」的文件。
- **protocol 是契约层**：`src/protocol/` 的文件清单与 `src/protocol/README.md` 的登记逐一对上（多一个没登记的就红）；除登记在册的 I/O 例外，protocol 文件不许 import `node:fs`／`node:child_process`／`node:http`／`node:net`，不许调用 `fetch`／`spawn`。
- **宿主 → 宿主组合面**是唯一放行的跨目录 import（写死 `src/modules/agentbar/`、`src/modules/library/` 两个目录）；`src/api`、`src/host`、`src/services` import 其余任何模块内部仍然为 0。

反证五则，贴输出后还原：(a) 临时把某个模块文件改成只从 protocol 转供的壳；(b) 临时在 `src/protocol/` 里写一个 `fetch()`；(c) 临时在 `src/protocol/` 新建一个没登记的文件；(d) 临时让 `src/api` import 某个非宿主组合面模块的内部；(e) 临时让 `roleplay` 静态 import `deduce` 的内部文件。

## 不做

- 不改任何对外契约（端点 id、路径、方法、请求/响应形状、错误码、MCP 工具名）；不改落盘格式；金样测试（`decoupleStep2`／`decoupleStep3`）一个字不动。
- 不碰作者真库与真实 `%LOCALAPPDATA%`。不许为了让门禁变绿再加白名单或放宽断言；确实下不了的，停下来上报。

## 验收

- 机器门禁全绿；红线测试 `test/moduleCoverage.test.mjs`、`test/decoupleStep1.test.mjs`、`test/decoupleStep2.test.mjs`、`test/decoupleStep3.test.mjs`、`test/hostApi.test.mjs`、`test/handlerDispatch.test.mjs` 全绿。
- 回报里贴：归属与消费路径逐条处置表（每条写走了四条路里的哪一条、`文件:行`）；`src/protocol/` 与 `src/services/` 的最终清单；四条规则与三条新断言的实测数字。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。

---

## OS-195a 验收记录（实施完成）

状态：已完成（对外契约零改动：端点 103／MCP 工具名／错误码／落盘格式／金样测试均未动）。

### 归属与消费路径逐条处置表

| 用途 | 走哪条路 | 落点（文件:行） |
|---|---|---|
| `agentStore.mjs` 搬回 agentbar | 归属①（模块实现回自己目录） | `src/modules/agentbar/agentStore.mjs:1` |
| `deduceSession.mjs` 搬回 deduce | 归属① | `src/modules/deduce/deduceSession.mjs:1` |
| `habits.mjs` 搬回 habits | 归属① | `src/modules/habits/habits.mjs:1` |
| `knowledge*` 三件搬回 knowledge | 归属① | `src/modules/knowledge/knowledge{Adapter,Health,Router}.mjs:1` |
| `importAdapter`／`libraryTextUtil` 搬回 library | 归属① | `src/modules/library/{importAdapter,textUtil}.mjs:1` |
| `libraryInventory` 搬回 storage，登记 `storage.inventory@1` | 路①（内核句柄） | `src/modules/storage/{libraryInventory,index}.mjs:1`；`src/modules/storage/module.manifest.json:18` |
| `referenceStore` 搬回 worldbook | 归属① | `src/modules/worldbook/referenceStore.mjs:1` |
| `agentCredentials` 搬回 agent-runtime | 路①（能力句柄） | `src/modules/agent-runtime/credentials.mjs:1` |
| roleplay → 会话读写 | **路①** | `src/modules/roleplay/handlers.mjs:64`（从 `deduce` 句柄解构）；`src/modules/deduce/deduceCapability.mjs:28` 补齐方法 |
| imagegen → `safeDeduceBookId` | **路①** | `src/modules/imagegen/handlers.mjs:21`；`src/modules/imagegen/index.mjs:6` |
| imagegen → 世界书条目存图 | **路④（端点分派）** | `referenceImageGenerate` 归 `src/modules/worldbook/handlers.mjs:166`；manifest 同步，端点数不变 |
| artifacts → 库内盘点 | **路①** | `src/modules/artifacts/handlers.mjs:4`；`src/modules/artifacts/index.mjs:6` |
| libraryManage → 整目录导入 | **路②（宿主直引宿主组合面）** | `src/host/libraryManage.mjs:21` |
| daemon → Agent 存储／配置路径 | **路②** | `src/host/daemon.mjs:44`；`src/api/handlers/agent.mjs:34` |
| 宿主写前习惯 lint／提示词习惯段 | **路③（钩子贡献）** | `src/modules/habits/index.mjs:9`；`src/host/moduleHooks.mjs:16` |
| 宿主 KB 先例片段／启动探活 | **路③** | `src/modules/knowledge/index.mjs:11`；`src/services/systemPrompt.mjs:17` |
| 宿主 Agent 上下文的世界书索引／syncCheck 索引 | **路③** | `src/modules/worldbook/index.mjs:24`；`src/host/moduleHooks.mjs:35` |
| 宿主 handler（agent/fact/reference/system）取内核 | **路①** | `resolveAgentRuntimeCapability`／`resolveFactCapability`／`resolveStorageCapability` 于四个 handler 内 |
| agentbar 凭据掩码 | **路①** | `test/agent.test.mjs:159` 经 `K.agentRuntime.maskApiKey` 注入；agentbar 零静态跨模块 import |

### 终态清单

- `src/protocol/`（37 个 `.mjs`，与 README 逐一对上）：`agentEvents apiErrors authorize baseCapabilities capabilityGraph capabilityImplementations capabilityMigration capabilityResolver changelog chapterNumber contractHelpers courtyard deduceRules dependencyGraph embeddingBackend factGuard hostWrite httpText index kernelErrors kernelPlumber libState libraryUpgrade moduleActivation moduleEntry moduleIdentity moduleManifest modules naming plugins rootPath runtimeShelf shelfManifests slots upstream versionGate worldbookContract`。
- `src/services/`（7 个）：`genres.mjs`、`runtimes.mjs`、`skills.mjs`、`stylePacks.mjs`、`suites.mjs`、`syncCheck.mjs`、`systemPrompt.mjs`。

### 四条规则与三条新断言实测（S2.1 原文）

```
✓ [S2.1] 能力路由边界（175 个 src 源文件；外部→模块 0（例外：实现登记表＋宿主组合面）；跨模块 0；
  底座→工作台 0；协议复制 0；OS-195a 新断言：模块壳 0／协议清单 37 文件（登记 37，I/O 例外 12）
  越界 0／宿主组合面放行 3 条越界 0）
验收门禁：28 过 / 0 挂 / 0 警
```

### 反证五则（均已还原）

| 反证 | 红输出要点 |
|---|---|
| (a) 模块文件改转供壳 | 模块壳 1，`src/modules/habits/habits.mjs:1 -> src/protocol/`：空壳；24 过／4 挂 |
| (b) protocol 写 `fetch()` | 越界 1，`src/protocol/embeddingBackend.mjs:1 -> fetch/spawn`：协议层不许调用 fetch/spawn；25 过／3 挂 |
| (c) protocol 新建未登记文件 | 38 文件／登记 37，越界 1，`tempProbe.mjs 没登记`；25 过／3 挂 |
| (d) api import 非宿主组合面模块 | 外部→模块 1、底座→工作台 1、宿主组合面越界 1；23 过／5 挂 |
| (e) roleplay 静态 import deduce 内部 | 跨模块 1，`roleplay/handlers.mjs:728 -> modules/deduce/deduceSession.mjs`；24 过／4 挂 |

### 验证命令

`npm test` 816/816；`node tools/acceptance/acceptance.mjs` 28/28；红线六件套全绿；
`node tools/number-anchors.mjs --check` 与写回、`npm run arch:stats` 与 `--check`、`git diff --check` 均通过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 2 轮 · 测试 绿（tests 816 · pass 814 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED: `tools/verify/verify-os172-e2e.mjs`（第 8–9 行）——把失效的两条 import 从已删除的 `src/services/agentConfig.mjs`、`src/services/chatUpstream.mjs` 改指到 OS-195a 搬移后的 `src/modules/agent-runtime/config.mjs`、`src/modules/agent-runtime/chatUpstream.mjs`。未改任何其他文件；未执行 git 命令；未操作 8807 daemon（e2e 工具自起的是隔离临时实例，端口 0，已自行关闭）。

VERIFIED:
- 复现：`node tools/verify/verify-os172-e2e.mjs` → `ERR_MODULE_NOT_FOUND: ...\src\services\agentConfig.mjs`（定位：上一轮删掉 services 兼容叶时漏改该验证脚本的 import，`chatUpstream.mjs` 同样已失效）。
- 修复后 `node tools/verify/verify-os172-e2e.mjs` → 水浒 10/10、新建/半成品 13/13 全绿，末行 `✓ OS-172 水浒临时库与新建/半成品库 e2e 全绿（假上游 1 次请求）`。
- `npm test` → tests 816 / pass 814 / fail 0 / skip 2。
- `node tools/acceptance/acceptance.mjs` → 28 过 / 0 挂 / 0 警。
- 未删除、skip 或放宽任何测试；门禁断言未动。

LIMITATIONS: 发现另有一类同源残留但未改：`tools/eval/eval-kbw.mjs:19` 与 `tools/eval/write-sample.mjs:13` 仍 import 已删除的 `src/services/style-check.mjs`（现实现在 `src/modules/text/lint.mjs`）。它们不在工单「允许改动」清单内，也不在本次必跑的测试/门禁/e2e 覆盖范围内，故按范围约束未动；如需一并修复请授权。
```
