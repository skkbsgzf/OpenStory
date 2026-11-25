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
