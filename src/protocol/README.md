# src/protocol —— 底座契约清单（OS-195）

`src/protocol/` 只放**底座契约**：请求/响应形状与错误信封、路径安全、授权、写管道、装载协议、
能力图与迁移、slots、命名取表口、旧库一次性升级、进程内事件词表，以及与任何工作台无关的
格式/路径纯函数。转发叶（`export ... from '../modules/…'`）已全部清零（门禁 S2.1／S2.7／S2.11 直接数
静态 import 验证）；模块内部实现只许被本模块 handler 与前端视图触及，宿主与服务只经底座契约或
`activate(context)` 的 `context.resolve` 句柄取能力。

实现登记表 `src/protocol/capabilityImplementations.mjs` 是**唯一**允许静态 import 内核实现的位置
（R-a）；其余位置（含工作台、宿主、服务、协议其他文件）静态 import 内核实现＝0。

## 逐个文件：为什么是宪法

### 形状、错误与进程内词表

| 文件 | 一句话 |
|---|---|
| `index.mjs` | `host-api@2` 七命名空间的唯一对外入口，冻结形状与错误信封的对外门面。 |
| `contractHelpers.mjs` | 契约表共用的请求/响应形状与校验纯函数，所有端点说同一种语言。 |
| `apiErrors.mjs` | `API_ERROR_CODES` 错误码词表，前端与 MCP 靠它稳定识别 404/409/503。 |
| `httpText.mjs` | HTTP 文本/JSON 响应的纯编码约定，契约壳与各域共用。 |
| `agentEvents.mjs` | AG-UI 事件词表与 SSE 帧投影，进程内事件不落盘、格式全仓唯一。 |
| `deduceRules.mjs` | 确定性推演规则包的只读装载与校验，规则是数据而非工作台内部。 |

### 路径安全、授权与写管道

| 文件 | 一句话 |
|---|---|
| `rootPath.mjs` | 库根解析的唯一纯函数入口，所有库内路径必须由此锚定。 |
| `authorize.mjs` | 路径授权与逃逸拒绝，任何写操作都绕不过这道闸。 |
| `courtyard.mjs` | 本机院子唯一路径来源（路径安全），本机其余目录不读、不写、不删。 |
| `hostWrite.mjs` | 宿主写协议唯一入口（tmp＋fsync＋rename＋目录 fsync），落盘不可绕过。 |
| `kernelPlumber.mjs` | 内核 `ok/fail/writeFileAtomic` 的只读转供，供 OS-123 fork 点维持函数体逐字不动。 |
| `kernelErrors.mjs` | 内核错误信封词表，内核与底座共用的错误语言。 |
| `changelog.mjs` | 库内唯一 diff/log 留痕通道（月度 jsonl＋内容哈希），每次修改可自检索。 |
| `libState.mjs` | 库内 `ui-state.json` 的读写协议，界面状态只能落这里。 |

### 装载协议、能力图与迁移

| 文件 | 一句话 |
|---|---|
| `modules.mjs` | `openstory-module@2` 装载/校验/启停/端点归属的唯一判定入口。 |
| `moduleManifest.mjs` | manifest 形状校验，决定谁有资格被装载。 |
| `moduleIdentity.mjs` | 模块身份与来源记录，冲突裁决由底座而非冲突双方做。 |
| `moduleEntry.mjs` | 工作台 `activate()` 样板，解析 hard requires 并登记贡献。 |
| `moduleActivation.mjs` | 贡献形状双向校验（handler 键↔manifest 端点），声明与实现不许分叉。 |
| `capabilityGraph.mjs` | 不可变能力快照与三检查＋候选启停事务，覆盖冲突不能由被覆盖方裁决。 |
| `capabilityResolver.mjs` | 按区间解析 provider 的冻结薄代理，句柄绑定不可变快照。 |
| `capabilityImplementations.mjs` | 内核实现的唯一静态入口登记表（R-a 的唯一例外）。 |
| `capabilityMigration.mjs` | 覆盖迁移器的失败安全阀与 journal，升级失败必须如实回滚。 |
| `baseCapabilities.mjs` | `base.process/loader/contract/write/naming` 五项底座句柄的装配处。 |
| `dependencyGraph.mjs` | 套件依赖闭包，装载前解析依赖而不在执行时猜。 |
| `plugins.mjs` | 插件/货架只读聚合与来源投影，插件系统自身不能被插件管理。 |
| `versionGate.mjs` | 宿主版本闸，跨版本兼容性由底座统一判定。 |
| `shelfManifests.mjs` | 五类货架投影成同一份 `module@2` 清单，能力图里一等公民。 |
| `runtimeShelf.mjs` | 运行时套件的受控命令描述解析，命令执行只在 agent.runtime 内。 |
| `slots.mjs` | slot 注册表，页面嵌入点只有一处声明。 |
| `naming.mjs` | 命名单一真源取表口（`public/views/registry.mjs` 只读 re-export），四层同名。 |
| `libraryUpgrade.mjs` | 旧库一次性升级（备份/迁移/退役留档/回滚），旧名只允许在这里出现。 |
| `embeddingBackend.mjs` | embedding 后端配置的只读解析，知识库与运行时共用。 |
| `upstream.mjs` | 上游模型通道的底座约定，跨运行时共用同一份解析口径。 |

### 与工作台无关的格式/路径纯函数（OS-195 由模块下沉）

| 文件 | 一句话 |
|---|---|
| `worldbookContract.mjs` | 世界书条目 md 文件格式（worldbook-file@2）的纯解析/序列化，导入与世界书共用同一判定。 |
| `libraryTextUtil.mjs` | 库内文本解析纯函数（章节号与世界书条目投影），无任何工作台归属。 |
| `libraryImport.mjs` | 整目录导入的格式适配（源只读/目标只新增），库管理端点与金样共用。 |
| `importAdapter.mjs` | 整目录导入适配实现本体，格式契约不随工作台启停变化。 |
| `libraryInventory.mjs` | 库内只读盘点与文件清单，产物/系统页面共用同一份「列」。 |
| `referenceStore.mjs` | 库内世界书索引的只读投影，宿主同步检查与世界书视图共用。 |
| `deduceSession.mjs` | 扮演会话容器与 id 安全（落盘格式与工作台无关）。 |
| `deduceRules.mjs` | （见上）推演规则包只读装载。 |
| `habits.mjs` | 习惯表读写与文本 lint 的底座实现，习惯工作台只拥有编辑入口。 |
| `agentStore.mjs` | Agent 会话 JSONL 与凭据配置，宿主对话面的共享设施。 |
| `agentCredentials.mjs` | 凭据尾号掩码的纯函数，响应永不回显完整 key。 |
| `knowledgeAdapter.mjs` | 本机 kb-config 的只读读取，知识库与提示词装配共用。 |
| `knowledgeHealth.mjs` | 本机 KB/embedding 服务探活，设置面板与对话链路共用降级口径。 |
| `knowledgeRouter.mjs` | 体裁×意图→知识块的确定性拼装，无 LLM、无工作台归属。 |
| `chapterNumber.mjs` | 章节号解析纯函数（OS-157 从 textUtil 上移），全仓唯一口径。 |
| `factGuard.mjs` | FACT-FIRST 上下文只读装配与直读审计，默认拒绝、点名放行。 |

## 边界纪律

- 插件只准经契约入口消费底座；模块只准 `node:`／`src/protocol/**`／本模块目录／已声明套件资源。
- `src/api`、`src/host`、`src/services` 不得静态 import 工作台内部实现；宿主组合根只经能力句柄装配。
- `src/protocol/**` 不得出现指向 `src/modules/**` 的 `export ... from`，也不得复制模块实现的函数体。
- `src/kernel/**` 管道件只依赖 `node:` 与内核内部；物理原子写实现全仓只有一份。
- 对外契约（端点、MCP 工具名、错误码、落盘格式）不随本清单调整。
