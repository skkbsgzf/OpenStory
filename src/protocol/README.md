# src/protocol —— 底座契约清单（OS-195 / OS-195a）

`src/protocol/` 只放**底座契约**：请求/响应形状与错误信封、路径安全、授权、写管道、装载协议、
能力图与迁移、slots、命名取表口、旧库一次性升级、进程内事件词表，以及与任何工作台无关的
格式/路径纯函数。**模块自己的实现住在自己的目录里**——OS-195a 把 OS-195 倒过来的转供改回去，
实现从本目录搬回 `src/modules/**`，模块文件不再是空壳。

本清单是门禁 `tools/acceptance/capabilityBoundaries.mjs` 的**唯一登记口**：本目录下每个 `.mjs`
文件都必须在下表逐字登记，多一个没登记的文件就红；表里也不许留已删文件。

实现登记表 `src/protocol/capabilityImplementations.mjs` 是**唯一**允许静态 import 内核实现的位置
（R-a）；其余位置（含工作台、宿主、服务、协议其他文件）静态 import 内核实现＝0。
工作台给宿主的东西一律经 `activate()` 贡献钩子（`moduleActivation.mjs` 登记钩子名），
宿主按库快照从同一张贡献表取（`src/host/handlerTable.mjs`）。

## 逐个文件：为什么是底座契约

### 形状、错误与进程内词表

| 文件 | 一句话 |
|---|---|
| `contractHelpers.mjs` | 契约表共用的请求/响应形状与校验纯函数，所有端点说同一种语言。 |
| `apiErrors.mjs` | `API_ERROR_CODES` 错误码词表，前端与 MCP 靠它稳定识别 404/409/503。 |
| `httpText.mjs` | HTTP 文本/JSON 响应的纯编码约定，契约壳与各域共用。 |
| `agentEvents.mjs` | AG-UI 事件词表与 SSE 帧投影，进程内事件不落盘、格式全仓唯一。 |

### 路径安全、授权与写管道

| 文件 | 一句话 |
|---|---|
| `rootPath.mjs` | 库根解析的唯一纯函数入口，所有库内路径必须由此锚定。 |
| `authorize.mjs` | 路径授权与逃逸拒绝，任何写操作都绕不过这道闸。 |
| `courtyard.mjs` | 本机院子唯一路径来源（路径安全，I/O 例外：确保目录存在），装载任何模块之前就要知道院子在哪。 |
| `hostWrite.mjs` | 宿主写协议唯一入口（I/O 例外：tmp＋fsync＋rename＋目录 fsync），落盘不可绕过。 |
| `kernelPlumber.mjs` | 内核 `ok/fail/writeFileAtomic` 的只读转供，供 OS-123 fork 点维持函数体逐字不动。 |
| `kernelErrors.mjs` | 内核错误信封词表，内核与底座共用的错误语言。 |
| `changelog.mjs` | 库内唯一 diff/log 留痕通道（I/O 例外：月度 jsonl＋内容哈希），每次修改可自检索。 |
| `libState.mjs` | 库内 `ui-state.json` 的读写协议，界面状态只能落这里。 |

### 装载协议、能力图与迁移

| 文件 | 一句话 |
|---|---|
| `modules.mjs` | `openstory-module@2` 装载/校验/启停/端点归属的唯一判定入口。 |
| `moduleManifest.mjs` | manifest 形状校验，决定谁有资格被装载。 |
| `moduleIdentity.mjs` | 模块身份与来源记录，冲突裁决由底座而非冲突双方做。 |
| `moduleEntry.mjs` | 工作台 `activate()` 样板，解析 hard requires 并登记 handlers／hooks 贡献。 |
| `moduleActivation.mjs` | 贡献形状双向校验（handler 键↔manifest 端点；钩子名↔登记钩子表），声明与实现不许分叉。 |
| `capabilityGraph.mjs` | 不可变能力快照与三检查＋候选启停事务，覆盖冲突不能由被覆盖方裁决。 |
| `capabilityResolver.mjs` | 按区间解析 provider 的冻结薄代理，句柄绑定不可变快照。 |
| `capabilityImplementations.mjs` | 内核实现的唯一静态入口登记表（R-a 的唯一例外）。 |
| `capabilityMigration.mjs` | 覆盖迁移器的失败安全阀与 journal（I/O 例外），升级失败必须如实回滚。 |
| `baseCapabilities.mjs` | `base.process/loader/contract/write/naming` 五项底座句柄的装配处。 |
| `dependencyGraph.mjs` | 套件依赖闭包，装载前解析依赖而不在执行时猜。 |
| `plugins.mjs` | 插件/货架只读聚合与来源投影，插件系统自身不能被插件管理。 |
| `versionGate.mjs` | 宿主版本闸，跨版本兼容性由底座统一判定。 |
| `shelfManifests.mjs` | 五类货架投影成同一份 `module@2` 清单；`loadRuntimeKitFacts` 是 runtime kit 清单的底座只读口，sidecar 生命周期不在本层。 |
| `slots.mjs` | slot 注册表，页面嵌入点只有一处声明。 |
| `naming.mjs` | 命名单一真源取表口（`public/views/registry.mjs` 只读 re-export），四层同名。 |
| `libraryUpgrade.mjs` | 旧库一次性升级（I/O 例外：备份/迁移/退役留档/回滚），旧名只允许在这里出现。 |

### 与工作台无关的格式/路径纯函数（OS-195 由模块下沉，OS-195a 保留在底座的两件）

| 文件 | 一句话 |
|---|---|
| `worldbookContract.mjs` | 世界书条目 md 文件格式（worldbook-file@2）的纯解析/序列化，导入与世界书共用同一判定。 |
| `deduceRules.mjs` | 确定性推演规则包的只读装载与校验（只读读盘），规则是数据而非工作台内部。 |
| `chapterNumber.mjs` | 章节号解析纯函数（OS-157 从 textUtil 上移），全仓唯一口径。 |

## 登记在册的 I/O 例外

底座契约原则上不读写文件；下列文件是**登记在册**的例外，门禁据此放行 `node:fs` 等导入。
前五件是 OS-195a 工点名的写/迁移/目录管道；后六件是 OS-195 之前就存在的只读路径与形状判定，
本单不动其函数体，如实登记，不许借登记之名新加业务 I/O。

| 文件 | 放行范围 | 理由 |
|---|---|---|
| `hostWrite.mjs` | 文件写 | 宿主唯一物理写管道 |
| `changelog.mjs` | 文件写 | 库内唯一 diff/log 留痕通道 |
| `libraryUpgrade.mjs` | 读写/迁移 | 旧库一次性升级与回滚 |
| `capabilityMigration.mjs` | 读写/迁移 | 覆盖迁移 journal 与失败安全阀 |
| `courtyard.mjs` | 目录确保 | 装载任何模块前必须知道院子在哪 |
| `libState.mjs` | 只读/原子写 | 库内 `ui-state.json` 唯一读写协议 |
| `modules.mjs` | 只读 | manifest/启停状态只读判定 |
| `rootPath.mjs` | 只读 | 库根 realpath 解析 |
| `shelfManifests.mjs` | 只读 | 货架资源清单只读投影 |
| `versionGate.mjs` | 只读 | 宿主版本标记只读判定 |
| `deduceRules.mjs` | 只读 | 推演规则包只读装载 |

> 任何协议文件都不许调用 `fetch`／`spawn`，也不许 import `node:child_process`／`node:http`／
> `node:net`；本目录当前零命中。网络与子进程只许留在 `agent-runtime`／`knowledge` 模块实现里。

## 边界纪律

- 插件只准经契约入口消费底座；模块只准 `node:` 内置／`package.json` 的 `dependencies` 声明的包／
  `src/protocol/**`／本模块目录／已声明套件资源。门禁显式读 `package.json`，不写包名白名单；
  `@xenova/transformers` 由 `agent-runtime/embedding-server.mjs` 直接 import，不再经协议叶子绕行。
- OS-195b 三条新断言（S2.1 实测）：`src/protocol/**` 里 import 实现登记表＝0；`src/protocol/**`
  从 `src/services/**`／`src/modules/**`／`public/**` 的 `export … from`＝0；生产源码
  `src/**` 里模块顶层持有 `KERNEL_CAPABILITIES` 的只许登记表自身。
- FACT-FIRST 写前守卫归 `src/modules/prose/factGuard.mjs`（`prose.write` 的一部分），读事实经
  `fact.store`／`fact.pack` 句柄；运行时 kit 的 sidecar 生命周期与探活归 `src/modules/agent-runtime/`，
  底座服务 `src/services/runtimes.mjs` 只留清单装载；`host-api@2` 第二套入口已退役，身份常量只在 `src/kernel/`。
- `src/api`、`src/host`、`src/services` 不得静态 import 工作台内部实现；唯一放行的跨目录 import
  是「宿主 → 宿主组合面」（`src/modules/agentbar/`、`src/modules/library/` 两个目录）。
- 宿主要用工作台能力（习惯 lint、提示词片段、世界书索引、KB 探活）只经 `activate()` 贡献的钩子，
  钩子名必须在 `src/protocol/moduleActivation.mjs` 登记；模块停用＝贡献消失。
- `src/protocol/**` 不得出现指向 `src/modules/**` 的 `export ... from`，也不得复制模块实现的函数体。
- `src/kernel/**` 管道件只依赖 `node:` 与内核内部；物理原子写实现全仓只有一份。
- 对外契约（端点、MCP 工具名、错误码、落盘格式）不随本清单调整。
