# OpenStory 架构

> 分层与实测（OS-133 归档，OS-150 起数字由脚本生成；OS-157 起 L2/L3 合并为「自有内核」一层）。本文所有「N 文件 / N 行」只出现在
> 下方**生成表**里——它由 `tools/arch-stats.mjs` 按约定目录扫描实测生成，标记
> `arch-stats:start` 与 `arch-stats:end` 圈定范围，叙述部分不再手写会漂的数字。
> 改了文件结构或行数：跑 `npm run arch:stats` 回写生成表；`node tools/arch-stats.mjs --check`
> 与验收门禁 S0.2 逐字比对，手改一个数字就红。
> OS-140 布局归一后自持模块收进 `src/` 六目录，仓根只留 `daemon.mjs`/`mcp.mjs` 两个入口垫片
> （布局宪法见 AGENTS.md 硬规则 7；分层是逻辑职责，物理布局见路径表）。

## 数据优先级（一级公民声明）

**见 [FACT-FIRST.md](docs/FACT-FIRST.md)。** 一句话：

```
① 事实链 fact entries（事件/人物/设定/关系/因果图/需求层级/台账）
② 正文   chapters（.md 原文）
③ 派生物 wiki 快照 / RAG 索引 / 推演会话
```

事实链是正文的**结构化投影**，每条事件都带 `sources[]`（源文件＋段号＋quote_hash）可回指原文。
所以读数据先问「事实链里有没有」，喂模型先问「能不能只喂事实链」；正文用作出处与兜底。

这一优先级对所有模块有约束力：任何绕过 `factStore`（内核公开面出口，factFileStore）
直接读正文喂模型的做法，都算违约。

## 分层（自上而下，依赖只许向下）

下面这张表是**生成段**：文件数与行数由 `tools/arch-stats.mjs` 实测，不要手改（改目录结构后跑
`npm run arch:stats` 回写）。L7–L2 各节的规模数字一律以本表为准，正文只写职责与边界。

<!-- arch-stats:start -->
| 层 | 目录 | 文件数 | 行数 |
|---|---|---:|---:|
| L7 前端 | `public/`（含 `views/`） | 20 | 21,021 |
| L6 契约层 | `src/api/contracts/` | 9 | 1,438 |
| L5 宿主层 | `src/host/` | 6 | 1,713 |
| L4 自持层 | `src/{modules,services,protocol}/` | 72 | 15,721 |
| L2 自有内核 | `src/kernel/` | 11 | 1,871 |
| L1 磁盘库 | 库＝文件夹（无代码） | — | — |

| 附加指标 | 实测 |
|---|---:|
| `public/app.js` 行数 | 12,314 |
| 契约端点数（`method:` 计数） | 105 |
| 测试文件数（`test/*.test.mjs`） | 78 |
<!-- arch-stats:end -->

```
L7 前端 → L6 契约层 → L5 宿主层 → L4 自持层 → L2 自有内核 → L1 磁盘库
```

### L7 前端 `public/`

- **职责**：工作台单页（无构建、原生 ES 模块）。`index.html`（样式令牌 `:root` 单一真源）
  ＋ `app.js`（装配壳：路由/页签消费/左列 Agent）＋ 零依赖模块
  （analysis/analysisModules/charts/graph/md/reference/referenceStore/script/scriptFact/
  scriptFormat/storySource/storyTree/ui-kit＋`views/registry.mjs` 页签/路由声明式注册表
  ＋`views/settingsAggregation.mjs` 设置聚合与设置页渲染＋`views/chapterLoad.mjs` 章节加载状态机
  ＋`views/runtimeShelf.mjs` 运行时货架）；echarts 本地 vendor（`public/vendor/echarts.min.js`）。
- **页签/路由注册协议（OS-143）**：页签系统唯一真源在 `views/registry.mjs`（TAB_REGISTRY
  纯数据＋computeTabDefs/dirTabDefs/viewScope 纯函数，词表外目录不出页签、退场目录无条件
  过滤都可测试）；`app.js` 是消费壳——renderTabs/go/openTabAdd 全由注册表驱动，视图渲染
  函数本体经 `VIEW_RENDERERS` 注册名插座解耦（registry 只存名字，绝不 import app.js，
  依赖方向恒为壳→表）。**`app.js` 增量冻结**：此后只许减不许增（修 bug 除外），
  视图代码只出不进（G5 逐个迁出，迁出后从模块侧重新注册渲染名）。
  **口径补钉（OS-146）**：`app.js` 只留**接线**（取数 → 转交，必要时一行占位），
  **视图渲染函数一律在 `public/views/`**——新增渲染函数留在 app.js 算违约
  （判例：`settingsModuleSettingsSectionHtml` 本体已迁 `views/settingsAggregation.mjs`）。
- **命名单一真源（OS-148/G8a·G8d）**：同一概念在五层（磁盘目录／页签名／changelog 模块／
  契约域／MCP 工具名前缀）的名字只有一份数据——`views/registry.mjs` 的 `NAMING_TABLE`
  （含 `dir/tab/panelLabel/logModule/contract/mcpPrefix` 六列＋三列实况补注）。
  页签条目的 `dir`/`label`/`panelLabel` 由 `tabNaming(概念id)` 派生；`DIR_LABELS`/`DIR_ORDER`/
  `READONLY_DIRS`/`PAGE_TO_DIR_LOCAL`/`LOG_MODULES` 逐键派生；后端**只 re-export**——
  `src/protocol/naming.mjs` 是 Host 侧取表口，`chapterWrite.moduleOfPath`（目录→日志模块）、
  `deduceSession.DEDUCE_SESSION_DIR`、各模块写日志的 `LOG_MODULES` 常量都从这里取，
  `app.js` 的「视图→日志模块」走 `logModuleForView()`。表为什么落在注册表而不是独立
  `public/naming.mjs`：注册表有「零 import」纯度门禁，且它本来就是目录词表/页签名的唯一真源
  （理由钉在 AGENTS.md 硬规则 21）。门禁：`test/naming.test.mjs`＋验收 S2.5。
- **边界**：只经 HTTP 契约（L6）与 daemon 说话；不落任何内容性/状态性数据（OS-89，
  浏览器只做内存视图）；前端模块互不 import（门禁 S2.2，md.mjs 渲染协议除外；
  app.js 经动态 import 消费 registry/ui-kit 等 leaf 模块）。

### L6 契约层 `src/api/`

- **职责**：API 形状唯一真源（OS-130 契约分域）。`src/api/contracts.mjs` 聚合七域分片
  （`src/api/contracts/`）：
  library / chapters / fact / reference / agent / plugins / system 七域，端点总数见上方生成表
  （按 `method:` 计数，与验收 S2.3 同口径）；请求/响应双端校验，daemon 与前端共享同一份。
  端点实现（OS-141 拆出）在 `src/api/handlers/`：七域 handler，键＝endpointId。
  错误码词表含 OS-136 来源防护两码：`FORBIDDEN_ORIGIN`（Host/Origin/Sec-Fetch-Site 拒收，403）、
  `UNSUPPORTED_MEDIA_TYPE`（带 body 非 JSON，400）。
- **边界**：纯数据＋纯函数，零依赖（不 import node:path/fs，浏览器也能载入）；
  改形状＝改对应域分片，两端一起跟。

### L5 宿主层 `src/host/`

- **职责**：node:http 手写路由，只监听 127.0.0.1:8807（`DEFAULT_PORT` src/host/http.mjs:16，daemon 第 76 行再出口）。
  仓根零 `.mjs`（OS-159）：入口直跑 `src/host/daemon.mjs` / `src/host/mcp.mjs`（实现文件自带 isMain 判定）。
  endpointFor 契约分派＋validateResponse 响应校验；**唯一磁盘写入面**（原子写＋.history
  备份）；SSE 通道；**OS-136 来源防护四层闸**——①Host 闸全局生效（只认
  `127.0.0.1/localhost/[::1]`＋实际绑定端口，防 DNS 重绑定）；②Origin／③Sec-Fetch-Site
  两道闸管全部 `/api`（只放行本机回环源与 same-origin/none；不带 Origin 的本机进程——
  node fetch/curl/直接调 src/host/mcp.mjs——不受影响）；④带 body 必须 application/json（跨站
  text/plain 简单请求从此写不进来；`FORBIDDEN_ORIGIN`=403、`UNSUPPORTED_MEDIA_TYPE`=400，
  专项测试 `test/originGuard.test.mjs`）；**OS-127 进程治理**——单实例锁
  （`%LOCALAPPDATA%/PinaxNext/openstory/daemon.lock`）、acquire/stamp/clear 三步闸、
  generation 代际继承、`/api/health` 读 DAEMON_RUNTIME。
- **伴生进程**：`src/host/mcp.mjs`（stdio JSON-RPC，**24 工具**）是 daemon HTTP 的薄适配层
  ——数据操作全部转发本机 daemon，唯一直算例外是 analysis 纯函数；不套娃（不开 agent 对话）。
  **模块闸口径（OS-146）**：分析工具只在**显式给了 root** 时按该库的 `modules.enabled.analysis`
  判定；不给 root ＝没有库上下文，不做模块闸——**绝不回落到本机库清单第一条**（那会让工具行为
  随「本机装了几个库」漂移，测试不 hermetic）。
- **边界**：业务逻辑下沉 L4；daemon 只做分派、校验、落盘与进程治理。

### L4 本仓自持层

OS-123/124 解耦后，建库/导入/章节号解析全部自持，不再 vendor。OS-140 起物理布局收进
`src/`（域模块 `src/modules/`、外围服务 `src/services/`、协议件 `src/protocol/`），
下面按逻辑职责组列表（规模见生成表）：

| 组 | 模块 |
|---|---|
| 建库与导入（OS-123/124 fork 点，src/modules/library/） | projectDoc（建库＋project.json 合同） / importAdapter（整目录导入） / textUtil（章节号＋世界书契约判定） / libraryManage |
| fact 消费与校验 | enrichEngine（语义富化 6 窗，src/services/） / factGuard（src/protocol/） / deduceEngine（推演核封装，src/modules/deduce/） / **engine/（OS-155 自 core 归位的确定性推演链 8 件：opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState＋出口 index.mjs——推演是产品引擎，不是内核能力）** / deduceSession（多局会话容器） / deduceNarrative / dependencyGraph（因果依赖图，src/protocol/） / syncCheck（正文↔拆解一致性，src/services/） |
| 协议层（OS-142 起为显式 Host API：`src/protocol/index.mjs` 入口＋叶子件，能力清单与版本约定见 [src/protocol/README.md](./src/protocol/README.md)） | index（host-api@2 入口：fact/prose/changelog/jobs/events/plugins/guard 七命名空间，全部冻结对象；键清单快照由 test/hostApi.test.mjs 钉死） / chapters（正文读写协议） / chapterWrite（正文写备份＋.history 保留策略） / changelog（diff＋月度 jsonl） / versionGate（插件版本闸） / plugins（三货架只读聚合） / dependencyGraph（套件依赖闭包） / agentEvents（AG-UI canonical 事件＋SSE 投影） / factGuard（FACT-FIRST 守卫） / libState（库内状态与草稿） / hostWrite（OS-138 宿主写协议唯一入口——原子写收敛，内联 tmp＋rename 全归一处） ＋转供叶子 kernelPlumber / authorize / apiErrors / upstream / worldbookContract（OS-142：把 fork 点 plumber、路径授权、错误码、上游模型通道、世界书契约按原名转供给模块层）/ **factDomain（OS-155：fact 域原语＋factPack 的只 re-export，给推演引擎——模块不许直引 src/kernel/）** |
| 参考/世界书 | referenceStore（标签/双链/图谱，src/modules/worldbook/） |
| Agent | agentStore（src/modules/agentbar/） / agentEvents（AG-UI canonical 事件模型＋SSE 投影，src/protocol/） / roleplayEngine / roleplayPrompts（后两者 src/modules/roleplay/） |
| 插件货架（src/services/，数据目录仍在仓根 suites//styles//runtimes//genres//skills/） | suites / skills / runtimes / genres / stylePacks |
| 模块插件（OS-144，`src/modules/<id>/module.manifest.json`＝`openstory-module@1`） | analysis（manifest 声明；引擎仍是 public/analysis.mjs 零依赖纯函数，前端与 Node 共用，无 daemon 端点）/ comfyui（comfyEngine 生图；独占端点 deduceImage / referenceImageGenerate / visionDescribe）/ kb（kbRouter / kbAdapter / kbHealth；独占端点 kbStatusGet / kbConfigGet / kbConfigPut / kbTest）/ OS-161 三个普通模块：habits（习惯实现已移入模块目录，独占 habitsGet / habitsPut；lint 与提示词注入经宿主钩子 `src/host/moduleHooks.mjs`）/ storysource（零独占端点——读宿主共享 fact 端点，停用不影响它们）/ artifacts（独占 artifactsGet）/ exchange（pedia/v1↔fact.data/v3 薄适配，独占 exchangeImport / exchangeExport；写复用 factEntriesImport 抽出的共用函数）。启停判定单一入口 `src/protocol/modules.mjs` 的 isModuleEnabled（ui-state `modules.enabled.<id>`，缺省 true）；独占端点停用回 MODULE_DISABLED，共用端点不受影响，值与数据保留。设置见下方「模块自报设置」表 |
| 引擎与周边（src/services/） | libState（src/protocol/） / jobCenter（任务中心） / nativePicker / dsh-bridge / dsh-cli / embedding-server / embeddingPaths / cli-bridge / style-check |

**模块自报设置（OS-145 立、OS-146 收紧口径）**：`openstory-module@1` 的 `settings` 是渲染声明，
字段口径对齐业务套件（`openstory-suite@2`）：`{ key, label, type: string|number|boolean|select, default, options? }`。
值落库内 ui-state `modules.settings.<id>.<key>`（扁平键，兼容嵌套写法）；聚合纯函数在
`public/views/settingsAggregation.mjs`（零 import，Node 测试可直接跑；app.js 只取数调用）。

**OS-146 铁律：界面上出现的每个设置项必须有真实消费者。** 上一版这里摆了 7 个输入框，
但生图/识图的真源是本机 `agent-config.json`（`loadConfigV2().image/.vision`）、知识库的真源是
本机 `kb-config.json`（`/api/kb/config`）、右栏卡片的真开关是 ui-state 的 `analyzeEnabled` 数组——
那 7 个键一个都没有消费者（改了不生效），已全部删除；迁移表随之清空（不许往库里写没人读的死键）。
真配置在别处的模块只报两句指路（manifest `settingsHint` 一句话 ＋ `settingsJump` 设置页区块 id），
设置页渲染成一行说明＋「去配置 →」按钮，不再摆第二份输入框。守卫：`test/moduleSettingsConsumers.test.mjs`
（键 → 消费者文件:符号 的表；新键不在表里＝红）。

| 模块 | manifest `settings` | 指路（settingsHint / settingsJump） |
|---|---|---|
| analysis | 空（没有可调参数；卡片勾选在右栏、AI 味阈值随扮演闸走） | 说明只有 settingsHint |
| comfyui | 空（真配置＝agent-config.json 的 image/vision） | 「设置 · 引擎与存储 · 对话模型与运行时」/ `engines` |
| kb | 空（真配置＝kb-config.json，`/api/kb/config`） | 「设置 · 引擎与存储 · 知识库」/ `engines` |

> 内核设置（daemon 端口语义、库路径、数据目录、凭据存储）是 L5 宿主的，不进 manifest、不插件化；
> 设置页把它们作为只读的「内核设置区」与各模块自报设置区聚合在同一个入口。

- **边界**（OS-142 升格为路径规则）：`src/modules/**` 只准引三类——node 内置模块
  （`node:` 前缀）、`src/protocol/**`（Host API：index.mjs 七命名空间＋叶子件）、自己模块
  目录内文件；模块间禁止直接 import（门禁 S2.1，静态 from 与动态 import() 都扫）。
  内核能力只从协议层 `fact` 命名空间取（经 L2 公开面五键转出，模块层不直引内核实现）；
  **插件只准 import `src/protocol/index.mjs`**。豁免唯一且显式点名：
  roleplayEngine→public/analysis.mjs（纯函数 AI 味分析，台账见 src/protocol/README.md）。

### L2 src/kernel/（自有内核，openstory-kernel@1）

内核自 2026-11-24 起为 OpenStory 自持实现；由 Pinax-next `feat/pinax-electron-next`@`70a4f44`
于 OS-152→OS-157 分批转自有，`core/`、`vendor/` 与 `npm run vendor:check` 已整体退役。
**无上游同步；互认靠落盘金样**（`test/decoupleStep2.test.mjs` 的建库格式逐字节锁定，
夹具抓取清单见 `docs/kernel-provenance.md` 第三节）。按能力分三组：

| 组 | 文件 | 职责 |
|---|---|---|
| 公开面/身份 | `index.mjs`（五键 factStore/enrich/ok/fail/writeFileAtomic）、`identity.mjs` | 唯一内核出口＋身份串，供协议层与 handler 直取 |
| 管道件 | `errors.mjs`（`KERNEL_ERROR_CODES` 25 值，OS-157 去前缀）、`atomicWrite.mjs`、`fsDurability.mjs` | 统一失败载荷；原子写（fsync＋rename＋目录 fsync）与失败清场 |
| fact 链 | `fact/factFileStore.mjs`（写协议唯一入口）、`fact/wikiDerive.mjs`、`fact/factPack.mjs`、`fact/domain/`（8 件＋桶 `index.mjs`） | `<库>/拆解/<id>.json` 的读写与 wiki 派生；词表/稳定 id/状态机/双时间轴/校验 |
| enrich | `enrich/pseudoChapters.mjs`、`enrich/metrics.mjs` | 纯函数只读度量（伪章推导＋因果图三指标） |

扩展名沿用迁移现状（domain 件为 `.js`，仅桶改名 `.mjs`）；arch-stats 的 L2 口径只计 `.mjs`，
7 件 `.js` 不进分层表文件数/行数。推演 8 件**不在内核**：OS-155 起归
`src/modules/deduce/engine/`，它是会产生会话状态与新条目的产品引擎（只读派生才留内核）；
llmPort 规范/兼容形态见 [docs/deduce-llm-port.md](./docs/deduce-llm-port.md)。
世界书文件契约亦不在内核：OS-157 起归 `src/modules/worldbook/worldbookFileContract.mjs`。

- **消费方**：API/宿主层 handlers/fact、handlers/reference、services/systemPrompt 直取
  `src/kernel/index.mjs`；协议层 protocol/index、protocol/factGuard 同取公开面；
  kernelPlumber/hostWrite 直取管道件。模块层经协议层 `fact` 命名空间与 `factDomain.mjs` 取，
  不直引内核实现。
- **边界**：写协议只经 `factFileStore.writeFactFile`（operationId 幂等＋expectedRevision 乐观并发，
  直测见 `test/factWriteProtocol.test.mjs`）；磁盘格式名冻结（见跨层红线 2）；
  门禁 S2.4' 钉死 `src/**` 不出现 `core/` 路径说明符。逐文件出处见
  `docs/kernel-provenance.md`，错误码改名见 `docs/error-code-rename.md`。

### L1 磁盘库 ——文件即真相

库＝文件夹，无数据库。`.pinax` 兼容形态与 Pinax 桌面端**双向兼容**：

| 位置 | 内容 |
|---|---|
| `正文/NNN-标题.md` `剧本/` `参考/` | 稿件（文件名即章节号） |
| `拆解/<bookId>.json` | fact 真源（`fact.data/v3`，**跨仓契约**）＋ `*.wiki.json` 派生 |
| `推演/<bookId>/` | session.json（多局）＋ 归档 ＋ .history |
| `.pinax/project.json` | spec `pinax-project@3`、schemaVersion 3、carriers{primary,enabled,revision}（**跨仓契约**，金样 `test/decoupleStep2.test.mjs` 钉死） |
| `.pinax/{drafts,log,ui-state.json,proposals,state}` | 草稿 / 模块日志（append-only jsonl） / 界面状态 / 提案 |
| `.openstory/{deduce,brief.json,agent-picks.json}` | 引擎会话状态 / 项目简报 / Agent 选择链 |
| `<同目录>/.history/` | 每版写前备份（二进制快照）；OS-137 起滚动保留——每原文件最新 `OPENSTORY_HISTORY_KEEP`（缺省 50）份＋每个自然日的最后一份（日锚），最新一份绝不删，删除留痕 `.pinax/log/history-prune/<yyyy-mm>.jsonl` |
| `%LOCALAPPDATA%/PinaxNext/openstory/`（不入库） | agent-config.json（凭据）、daemon.lock（进程治理）、suites/styles/runtimes 本机货架 |

- **边界**：除本机货架与锁文件外，一切状态落库内固定位置；关掉浏览器/换机器/清缓存，
  重新打开库必须完全复原（OS-89 判据）。

## 内核演进纪律（OS-157 起）

内核已自有，**不再有上游同步动作**（旧的三步 vendor 升级流程随 `core/`、`vendor/`、
`npm run vendor:check` 一并退役）。后续演进按三条：

1. **写协议只经 `factFileStore.writeFactFile`**：operationId 幂等、expectedRevision 乐观并发、
   revision 自增、wiki 旁挂分离——任何新写入通道都要先过这里，不许内联绕过。
2. **磁盘格式名冻结清单**：`.pinax/project.json`＝`pinax-project@3`、`拆解/*.json`＝`fact.data/v3`、
   `*.wiki.json`＝`pinax-wiki-derived@1`、`.pinax-tmp-*` 临时前缀（见 §1.4.1 与跨层红线 2）。
   变更须同时更新金样与 `docs/kernel-provenance.md` 的互认夹具口径。
3. **公开面变更走 Host API 版本语义**：`src/kernel/index.mjs` 新增出口先改
   `test/kernelIdentity.test.mjs` 快照；Host API 命名空间删成员/改签名/改语义才升 `host-api@3`，
   并同步 `test/hostApi.test.mjs` 的 SNAPSHOT 与 `src/protocol/README.md` 能力清单。

## 跨层红线

1. **内核实现只在 `src/kernel/**`**——`core/`、`vendor/` 已退役；门禁 S2.4' 钉死 `src/**`
   与仓根垫片不得出现 `core/` 路径说明符（防陈旧 import 回潮）。
2. **`project.json` 与 fact schema（`fact.data/v3`）是跨仓契约**——与 Pinax 桌面端
   双向兼容：spec `pinax-project@3`、schemaVersion 3、字段名与顺序、carriers 结构、
   fact 条目形状，一个字节不许变（金样护栏 `test/decoupleStep2.test.mjs`、
   `test/decoupleStep1.test.mjs`）。
3. **S2.4' 内核实现唯一**：`src/**` 与仓根垫片不得出现 `core/` 路径说明符；内核实现只在
   `src/kernel/`，公开面 `src/kernel/index.mjs` 五键。协议层 `factGuard`/`index` 直取公开面，
   `kernelPlumber`/`hostWrite` 直取管道件；模块层只经协议层取内核能力。世界书契约属世界书模块，
   经 `src/protocol/worldbookContract.mjs` 转供取用。
4. **依赖只许向下**（L7→L6→L5→L4→L2→L1 单向）；Pinax 从不 import OpenStory。
5. **daemon 来源防护闸不许拆**（OS-136）：Host／Origin／Sec-Fetch-Site 三道闸＋强制 JSON
   content-type 是「作者浏览器里的任意网页写不进本机 daemon」的纵深防线；所有端点（含
   `fsBrowse` 这类本机目录浏览）默认吃闸，不做绕行后门。本地进程本来就能直接读盘，
   不加目录白名单——OS-110/119 的「任意磁盘目录建库」行为不变。

## 插件生态（三层货架，协议各自成文）

| 层 | 协议 | 管什么 | 注册方式 |
|---|---|---|---|
| 业务套件 | [PROTOCOL.md](suites/PROTOCOL.md)（openstory-suite@2） | 业务域默认规则＋独立设置页＋（未来）业务页/工作流 | 目录＋manifest；capabilities 能力声明；宿主按声明加载 |
| Agent 运行时 kit | openstory-runtime-kit@1（`openstory/runtimes/README.md`） | 模型对话通道（sidecar/endpoint） | 目录＋manifest；chat 面＝OpenAI 兼容 SSE |
| 风格包 | tokens JSON | 整窗换肤＋栅格密度 | 目录＋tokens |

共同规则：**本机目录按 id 覆盖内置**；坏档跳过＋warning 不拖垮货架；停用＝规则退回内置默认
（值保留）；凭据只存本机。能力白名单见 OS-129（插件能力白名单，services 声明对齐宿主真实实现）。

## 与 Pinax 的关系

- 同一份文件资产、两个壳：Pinax（Electron 深度形态）与 OpenStory（浏览器轻形态）。
- 内核关系（OS-123→157 解耦收官后）：内核已全树自持于 `src/kernel/`（身份 `openstory-kernel@1`），
  最初逐字取自 Pinax-next@`70a4f44` 与 @pinax/core 0.16.0（`e56a0bc`），逐文件出处见
  `docs/kernel-provenance.md`；建库/导入/章节号/载体映射亦为本仓自持（projectDoc/importAdapter/
  chapterNumber）。**不再与上游同步**；兼容锚是落盘格式金样，不是代码字节。
  Pinax 从不 import OpenStory。
- 两侧设置互不干扰：OpenStory 的套件/运行时/风格配置全部只存本机 openstory 目录。

## 演进约定

- 契约先行：API 变更先改 `src/api/contracts/<域>.mjs`（OS-130 分域，端点总数见生成表），两端一起跟。
- 每批「界面上能看到新东西」；demo 数据退役一批、真数据上位一批。
- 插件协议升级走 schemaVersion（@2 起精确匹配＋@1 兼容读），不做半懂兼容。
- 遗留与明确不做的事项见 [docs/LEGACY-ITEMS.md](./docs/LEGACY-ITEMS.md)，不在本文重复。
