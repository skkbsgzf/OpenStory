# OS-200 · 后端投影补全：治理台的数据面

| 项 | 值 |
|---|---|
| 批次 | 第四批（插件前端适配）第 1 张；规划见 [`plugin-frontend-batch-20261126.md`](../plan/plugin-frontend-batch-20261126.md) §5 |
| 对应 | 规划书 §四-4.1「治理台不新造数据，后端只补推导字段」、§五 第 1 步；监督线实况 §4 第 1、2、7、8 条 |
| 依赖 | 无（清账批已全部收口，HEAD `030dd37`） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中——动 `/api/plugins` 的响应形状与启停闸的取数口；端点数与路径不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

`GET /api/plugins` 一次给齐治理台要用的全部推导数据：每件模块的依赖逐条解析状态、反向依赖、降级态、停用预检；slot 投影带降级标记；套件货架并入同一响应；启停闸与投影从同一份输入推导。**零新增端点。** 本单不做任何界面渲染（界面从 OS-201 起）。

## 现状（监督线 2026-11-26 实测，HEAD `030dd37`）

- `src/api/handlers/plugins.mjs` 的 `pluginsGet`：`modules[]` 只有身份与指路（`id/name/version/class/role/builtin/source/sourceDir/…/description/endpoints/pages/slots/settings/settingsHint/settingsJump`），**没有** `requires`／`capabilities`，也没有每件的启停与降级状态。
- 降级态其实已经算好：`snapshotFor(root)` 的快照里有 `statuses`（`disabled/degraded/loaded`＋`reasons`）、`issues`（缺哪条能力、谁在等）、`routes`（谁供给、版本、金样），并经 `capabilityReport` 下发——但前端 `public/app.js` 的 `loadPlugins()` 没有保留这一块。
- `src/protocol/slots.mjs` 的 `slotProjection(manifests, enabled, …)` 只看 `enabled`：停用模块的位置消失，**降级模块的位置照常出现、不带任何标记**；降级模块的端点回 `PLUGIN_DEGRADED`（503）。即「页签照常在、点进去才报错」。
- 启停闸 `uiStatePut`（`src/api/handlers/system.mjs`）调 `deriveModuleStateChange` 时只吃内置 `MODULE_MANIFESTS`，不带套件状态、不含本机覆盖与迁移剔除后的有效清单；投影用的却是 `effectiveManifestsFor(root)`＋`snapshotFor(root)`（带套件状态）。**两者不同源**——治理台上的「事前解释」可能与闸的实际裁决不一致。
- 套件货架走另一个端点 `GET /api/suites`（`listSuitesPublic`，带设置值与 schema），`/api/plugins.plugins[]` 不带。
- `public/views/settingsViews.mjs` 的 `reloadLocalState()` 自己再 fetch 一次 `/api/plugins` 并**局部覆盖** `state.plugins`（丢掉 `modules`、`capabilityReport` 等）。

## 任务

### 1. 模块条目补全（`modules[]` 每一项新增下列字段，既有字段一个不动）

| 字段 | 形状 | 来源／口径 |
|---|---|---|
| `requires` | `[{ id, min, maxExclusive, provider, version, golden?, builtin, ok, reason? }]` | manifest 的硬依赖逐条，对快照 `routes[id]` 解析：版本落在 `[min, maxExclusive)` 内＝`ok:true`；否则 `ok:false` 且 `reason` 取 `CAPABILITY_NOT_REGISTERED`／`CAPABILITY_VERSION_MISMATCH`／`CAPABILITY_CONFLICT`（与 `src/protocol/capabilityResolver.mjs` 同口径）。底座能力 `provider:'base'` |
| `optionalRequires` | 同形 | manifest 的可选依赖 |
| `capabilities` | `[{ id, version, golden? }]` | 内核件声明的供给；工作台为 `[]` |
| `enabled` | `boolean` | 该库 ui-state 的启停；宿主组合面恒 `true` |
| `status` | `'loaded'` ／ `'degraded'` ／ `'disabled'` | 快照的 `statuses` |
| `statusReasons` | `string[]` | 快照的 `statuses[].reasons` |
| `missing` | `[{ capability, min, maxExclusive }]` | 该件缺的硬依赖（快照 `issues` 里 `CAPABILITY_MISSING` 且消费方含本件的） |
| `optionalMissing` | 同形 | 快照 `optionalMissing` 里属于本件的 |
| `dependents` | `[{ id, name, enabled, status, capabilities }]` | **直接**反向依赖：`requires` 解析到本件供给能力的模块，声明了即列、带它自己的状态；`capabilities`＝它用到本件的那些能力 id |
| `impact` | `string[]` | 现在停用本件会连带降级、且**不在** `dependents` 里的模块 id（二跳及更远的连锁） |
| `toggleCheck` | `{ ok, code?, message?, consumers? }` 或 `null` | 停用预检，与启停闸**同一个函数、同一份输入**（见任务 5）：对 `{ ['modules.enabled.<id>']: false }` 这份补丁跑 `deriveModuleStateChange` 的结果 |

推导逻辑写成 `src/protocol/capabilityGraph.mjs` 里的**纯函数**（建议 `projectModuleGraph({ snapshot, manifests, state, suiteState, base })`），handler 只做装配；不许把推导散在 handler 里，也不许另写第二套依赖图。当前快照只建一次，别每件重建。

### 2. 能力图（响应新增顶层 `moduleGraph`）

```text
moduleGraph: {
  spec: 'openstory-module-graph@1',
  snapshot: <快照 id>,
  edges: [{ from, to, capability, min, maxExclusive, optional }],   // from＝依赖方模块 id；to＝供给方模块 id 或 'base'
  base:  [{ id, version, consumers: [模块 id] }]                      // 底座能力与谁依赖它（前端折叠成一条说明）
}
```

节点就是 `modules[]` 本身，不另存一份。边按依赖声明逐条展开（一条依赖一条边）。内置 21 件的健康态下：非底座边恰为 **38** 条，底座边恰为 **11** 条（`base.write` 4、`base.contract` 2、`base.naming` 5）。

### 3. slot 投影带降级标记（`src/protocol/slots.mjs`）

- `slotProjection` 增加可选入参 `statuses`（模块 id → `{ status, missing }`）。**降级**（已启用但不活跃）模块的位置照常下发，另带 `degraded: true` 与 `missing: [{ capability, min, maxExclusive }]`；健康位置**一个字段都不加**（形状不变）；停用模块的位置照旧消失。
- `pluginsGet` 调用时把快照的 `statuses` 传进去。

### 4. 套件货架并入（响应新增四个键）

`pluginsGet` 里调 `listSuitesPublic(shelfOpts(context, auth.root))`，下发 `suites`（与 `GET /api/suites` 的 `suites` 是同一份记录：设置值、schema、捆绑技能、`blocked` 等齐全）、`suiteOverrides`、`suiteUserDir`、`suiteWarnings`。`GET /api/suites` 端点原样保留（外部契约不动）。前端改读它是 OS-204 的事，本单不动界面。

### 5. 启停闸与投影同源（`uiStatePut`）

把「有效清单（本机覆盖＋迁移剔除）＋该库 ui-state＋该库套件状态」的取数收成 `src/host/moduleRuntime.mjs` 里的**一个出口**（建议 `graphInputsFor(root, env)`），`snapshotFor`、`pluginsGet` 的 `toggleCheck`、`uiStatePut` 的闸三处都从它取。只有内置 21 件时闸的行为一个字不变；有本机覆盖或套件状态时，闸看到的图与投影一致。

### 6. 契约、前端装载器、文档

- `src/api/contracts/plugins.mjs` 的 `pluginsGet.response` 登记新键：`moduleGraph: 'object?'`、`suites: 'array?'`、`suiteOverrides: 'array?'`、`suiteUserDir: 'string?'`、`suiteWarnings: 'array?'`；注释同步。端点数仍是 108。
- `public/app.js` 的 `loadPlugins()`：把响应**整体**留进 `state.plugins`（不再逐字段挑），缺省值照旧；`public/views/settingsViews.mjs` 的 `reloadLocalState()` 删掉，改调注入的 `loadPlugins()` 再 `render()`——同一份 `state.plugins` 不许再被局部覆盖。`app.js` 行数只许减不许增。
- `docs/protocol/module-manifest-2.md` 里 `/api/plugins` 响应一节补上新字段与降级标记；`AGENTS.md` 里讲 `/api/plugins` 的那几句同步。

## 测试（新建 `test/pluginGovernanceProjection.test.mjs`）

- **纯函数·健康态**（内置 21 件）：`moduleGraph.edges` 非底座 38 条、底座 11 条；`fact` 的 `dependents` 恰为 10 件（`agentbar/chapters/deduce/exchange/library/prose/roleplay/script/storysource/worldbook`）、`impact` 恰为 `['imagegen', 'log']`；`roleplay.requires` 四条全 `ok` 且 `provider` 分别是 `deduce/fact/prose/text`；内核件 `capabilities` 的金样标记与 manifest 逐项一致；12 件工作台 `toggleCheck.ok === true`。
- **同源**：对 21 件逐个调 `deriveModuleStateChange`（与闸同参）得 `{ ok, code }`，与 `toggleCheck` 逐件相等；`fact` 的 `toggleCheck.code === 'CAPABILITY_IN_USE'`；`agentbar`／`library` 为 `INVALID_ENTRY`。
- **slot**：`slotProjection` 带 `statuses` 时降级位置带 `degraded:true` 与 `missing`；不带 `statuses` 时输出与改前逐字相同（钉死「健康位置形状不变」）。
- **daemon 级**（临时 `LOCALAPPDATA`＋临时夹具库，写法照 `test/os198SlotsWiring.test.mjs` 的 `makeDaemon`）：
  - 健康库：`validateResponse('pluginsGet', payload).ok`；21 件 `status:'loaded'`；`slots.tab` 8 条、无一条带 `degraded`。
  - 造降级：依次 `PUT /api/ui-state` 停 `analysis`／`habits`／`roleplay` → 停内核件 `text` → 启用 `roleplay`。此后 `roleplay.status === 'degraded'`、`missing` 含 `{ capability: 'text.analyze', min: 1, maxExclusive: 2 }`、`requires` 里 `text.analyze` 那条 `ok:false`；`slots.tab` 里 `roleplay` 带 `degraded: true`；`text.dependents` 里 `roleplay.status === 'degraded'`。再停 `roleplay`，该位置消失。
  - 同源端到端：健康库上逐件——先取该件的 `toggleCheck`，再发停用补丁，HTTP 结果（状态码与错误码）与 `toggleCheck` 一致；改了状态的立刻启回来再测下一件。
  - 本机层：登记一个临时模块根（一个只依赖 `base.write` 的工作台，照 os198 测试的 `writeIframeModule`），`modules[]` 里有它且 `source:'local'`、`toggleCheck.ok === true`，`moduleGraph.edges` 含它的底座边。
  - 货架：`/api/plugins.suites` 与同库 `GET /api/suites` 的 `suites` 逐条 `id/name/version/enabled/blocked` 相等。
- 既有红线全绿：`test/plugins.test.mjs`、`test/modulePlugins.test.mjs`、`test/coreModules.test.mjs`、`test/os198SlotsWiring.test.mjs`、`test/slots.test.mjs`、`test/tabRegistry.test.mjs`、`test/localModules196a.test.mjs`、`test/capabilityGraph.test.mjs`、`test/capabilityMigrationWiring.test.mjs`。

## 不做

- 不新增端点、不改端点路径与 MCP 工具名；`GET /api/suites` 保留。
- 不做任何界面渲染（治理台与灰显在 OS-201～203）；不动验收门禁的检查项。

## 验收

- 机器门禁全绿；`app.js` 行数不增；`git diff --check` 干净。
- 生产调用点贴出来（`文件:行`）：推导函数、`pluginsGet` 装配、`uiStatePut` 取数、`loadPlugins` 整体保留。
- 反证一则：把 `uiStatePut` 临时改回只吃 `MODULE_MANIFESTS`，同源测试必须红；贴输出后还原。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 853 · pass 851 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED: 
- src/host/moduleRuntime.mjs（新增 `graphInputsFor`，`snapshotFor` 复用同源取数）
- src/protocol/capabilityGraph.mjs（新增纯函数 `projectModuleGraph`／`moduleStatusProjection`）
- src/protocol/slots.mjs（`slotProjection` 接受 `statuses`，降级位带 `degraded`/`missing`）
- src/api/handlers/plugins.mjs（装配新增字段、`moduleGraph`、slot 状态、货架四键）
- src/api/handlers/system.mjs（`uiStatePut` 闸改从 `graphInputsFor` 取数）
- src/api/contracts/plugins.mjs（`pluginsGet.response` 登记 5 个新键，端点仍 108）
- public/app.js（`loadPlugins` 整体保留响应；`app.js` 10107→10097 行，只减不增）
- public/views/settingsViews.mjs（删 `reloadLocalState`，改注入的 `loadPlugins`）
- docs/protocol/module-manifest-2.md（§5.6 治理台数据面）
- AGENTS.md、README.md、ARCHITECTURE.md、docs/number-anchors.json（文档/数字锚回写）
- test/pluginGovernanceProjection.test.mjs（新建：纯函数 3 项＋daemon 5 项）
- test/modulePlugins.test.mjs（既有断言等价加强：停用 `deduce` 的消费者从 `['imagegen','roleplay']` 改为含套件 `['deduce-rules','imagegen','roleplay']`；同源闸现在看见五类货架套件，比原断言覆盖更全，未删未放宽）

VERIFIED:
- `node --test test/pluginGovernanceProjection.test.mjs`：8/8 过（38 非底座边／11 底座边、fact 10 dependents 与 `['imagegen','log']` impact、逐件预检同源、slot 形状、daemon 降级与货架同源）。
- `npm test`：853 例／851 过／0 挂／2 跳过（既有红线全绿，含 plugins/modulePlugins/coreModules/os198SlotsWiring/slots/tabRegistry/localModules196a/capabilityGraph/capabilityMigrationWiring）。
- `node tools/acceptance/acceptance.mjs`：29 过／0 挂／0 警；`npm run arch:check`：生成段一致；`node tools/number-anchors.mjs --check`：数字锚一致（853 例／端点 108／app.js 10097≤10500）；`git diff --check`：干净。
- 按序回写：`npm run arch:stats` → `node tools/number-anchors.mjs`。
- 反证：临时把 `uiStatePut` 改回只吃 `MODULE_MANIFESTS` 后，`--test-name-pattern="同源端到端"` 红（`agent-runtime` 消费者实际仅 4 件内置模块，预检为 40 件含套件；`AssertionError` at test/pluginGovernanceProjection.test.mjs:204），输出后已逐字还原，还原后该测试绿。
- 生产调用点：`src/protocol/capabilityGraph.mjs:458` 推导函数、`:447` 状态投影；`src/api/handlers/plugins.mjs:144` 同源取数、`:152` 装配、`:160` slot 状态、`:209` 货架并入；`src/api/handlers/system.mjs:184` 启停闸取数；`public/app.js:3524` 装载器、`:3531` 整体保留；`src/protocol/slots.mjs:77` 降级标记；`src/host/moduleRuntime.mjs:485` 单一取数口。

LIMITATIONS: 无
```
