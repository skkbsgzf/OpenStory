# OpenStory 架构

> 七层实测分层（OS-133 归档，OS-150 起数字由脚本生成）。本文所有「N 文件 / N 行」只出现在
> 下方**生成表**里——它由 `scripts/arch-stats.mjs` 按约定目录扫描实测生成，标记
> `arch-stats:start` 与 `arch-stats:end` 圈定范围，叙述部分不再手写会漂的数字。
> 改了文件结构或行数：跑 `npm run arch:stats` 回写生成表；`node scripts/arch-stats.mjs --check`
> 与验收门禁 S0.2 逐字比对，手改一个数字就红。
> OS-140 布局归一后自持模块收进 `src/` 六目录，仓根只留 `daemon.mjs`/`mcp.mjs` 两个入口垫片
> （布局宪法见 AGENTS.md 硬规则 7；分层是逻辑职责，物理布局见路径表）。

## 数据优先级（一级公民声明）

**见 [FACT-FIRST.md](./FACT-FIRST.md)。** 一句话：

```
① 事实链 fact entries（事件/人物/设定/关系/因果图/需求层级/台账）
② 正文   chapters（.md 原文）
③ 派生物 wiki 快照 / RAG 索引 / 推演会话
```

事实链是正文的**结构化投影**，每条事件都带 `sources[]`（源文件＋段号＋quote_hash）可回指原文。
所以读数据先问「事实链里有没有」，喂模型先问「能不能只喂事实链」；正文用作出处与兜底。

这一优先级对所有模块有约束力：任何绕过 `factStore`（pinaxAdapter 出口，内核 factFileStore）
直接读正文喂模型的做法，都算违约。

## 七层分层（自上而下，依赖只许向下）

下面这张表是**生成段**：文件数与行数由 `scripts/arch-stats.mjs` 实测，不要手改（改目录结构后跑
`npm run arch:stats` 回写）。L7–L2 各节的规模数字一律以本表为准，正文只写职责与边界。

<!-- arch-stats:start -->
| 层 | 目录 | 文件数 | 行数 |
|---|---|---:|---:|
| L7 前端 | `public/`（含 `views/`） | 19 | 20,759 |
| L6 契约层 | `src/api/contracts/` | 8 | 1,381 |
| L5 宿主层 | `src/host/` | 5 | 1,657 |
| L4 自持层 | `src/{modules,services,protocol}/` | 56 | 13,124 |
| L3 内核进口 | `src/kernel/` | 1 | 68 |
| L2 内核 | `core/pinax/` | 24 | 4,332 |
| L1 磁盘库 | 库＝文件夹（无代码） | — | — |

| 附加指标 | 实测 |
|---|---:|
| `public/app.js` 行数 | 12,471 |
| 契约端点数（`method:` 计数） | 101 |
| 测试文件数（`test/*.test.mjs`） | 62 |
<!-- arch-stats:end -->

```
L7 前端 → L6 契约层 → L5 宿主层 → L4 自持层 → L3 内核进口 → L2 内核 → L1 磁盘库
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
  仓根 `daemon.mjs`/`mcp.mjs` 是入口垫片（`export * from` ＋仅 node 直跑才调 main，OS-140）。
  endpointFor 契约分派＋validateResponse 响应校验；**唯一磁盘写入面**（原子写＋.history
  备份）；SSE 通道；**OS-136 来源防护四层闸**——①Host 闸全局生效（只认
  `127.0.0.1/localhost/[::1]`＋实际绑定端口，防 DNS 重绑定）；②Origin／③Sec-Fetch-Site
  两道闸管全部 `/api`（只放行本机回环源与 same-origin/none；不带 Origin 的本机进程——
  node fetch/curl/mcp.mjs——不受影响）；④带 body 必须 application/json（跨站
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
| fact 消费与校验 | enrichEngine（语义富化 6 窗，src/services/） / factGuard（src/protocol/） / deduceEngine（推演核封装，src/modules/deduce/） / deduceSession（多局会话容器） / deduceNarrative / dependencyGraph（因果依赖图，src/protocol/） / syncCheck（正文↔拆解一致性，src/services/） |
| 协议层（OS-142 起为显式 Host API：`src/protocol/index.mjs` 入口＋叶子件，能力清单与版本约定见 [src/protocol/README.md](./src/protocol/README.md)） | index（host-api@1 入口：fact/prose/changelog/jobs/events/plugins/guard 七命名空间，全部冻结对象；键清单快照由 test/hostApi.test.mjs 钉死） / chapters（正文读写协议） / chapterWrite（正文写备份＋.history 保留策略） / changelog（diff＋月度 jsonl） / versionGate（插件版本闸） / plugins（三货架只读聚合） / dependencyGraph（套件依赖闭包） / agentEvents（AG-UI canonical 事件＋SSE 投影） / factGuard（FACT-FIRST 守卫） / libState（库内状态与草稿） / hostWrite（OS-138 宿主写协议唯一入口——原子写收敛，内联 tmp＋rename 全归一处） ＋转供叶子 kernelPlumber / authorize / apiErrors / upstream / worldbookContract（OS-142：把 fork 点 plumber、路径授权、错误码、上游模型通道、世界书契约按原名转供给模块层） |
| 参考/世界书 | referenceStore（标签/双链/图谱，src/modules/worldbook/） |
| Agent | agentStore（src/modules/agentbar/） / agentEvents（AG-UI canonical 事件模型＋SSE 投影，src/protocol/） / roleplayEngine / roleplayPrompts（后两者 src/modules/roleplay/） |
| 插件货架（src/services/，数据目录仍在仓根 suites//styles//runtimes//genres//skills/） | suites / skills / runtimes / genres / stylePacks |
| 模块插件（OS-144，`src/modules/<id>/module.manifest.json`＝`openstory-module@1`） | analysis（manifest 声明；引擎仍是 public/analysis.mjs 零依赖纯函数，前端与 Node 共用，无 daemon 端点）/ comfyui（comfyEngine 生图；独占端点 deduceImage / referenceImageGenerate / visionDescribe）/ kb（kbRouter / kbAdapter / kbHealth；独占端点 kbStatusGet / kbConfigGet / kbConfigPut / kbTest）。启停判定单一入口 `src/protocol/modules.mjs` 的 isModuleEnabled（ui-state `modules.enabled.<id>`，缺省 true）；独占端点停用回 MODULE_DISABLED，共用端点不受影响，值与数据保留。设置见下方「模块自报设置」表 |
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
  内核能力只从协议层 `fact` 命名空间取（经 L3 五组出口转出，模块层不再直引 pinaxAdapter）；
  **插件只准 import `src/protocol/index.mjs`**。豁免唯一且显式点名：
  roleplayEngine→public/analysis.mjs（纯函数 AI 味分析，台账见 src/protocol/README.md）。

### L3 src/kernel/pinaxAdapter.mjs（内核唯一进口）

- **职责**（OS-125 解耦③）：src/ 树＋仓根垫片里唯一允许 import `core/**` 的模块（门禁 S2.4
  扫描 `src/` 全部模块＋两个垫片）。**五能力组出口**：
  `factStore`（S1 只读 list/get ＋ S2 writeFactFile 写协议）、`deduce`（opening/turn/settle
  端子）、`enrich`（伪章推导＋因果图三指标）、`projectMeta`（转引本仓 projectDoc）、
  `projectImport`（转引本仓 importAdapter/textUtil）；后两组是自有能力的统一出口。
  另有最小补集 plumber（`ok`/`fail`/`writeFileAtomic`）仅限 projectDoc/importAdapter
  两个既有 fork 点使用；OS-138 写通道收敛起 hostWrite.mjs（全仓唯一写入口）也经本文件
  取 `writeFileAtomic`/`TMP_PREFIX`/`syncDirectory`，同属最小补集口径。
- **消费方**（OS-142 后 import 本文件的）：API/宿主层 api/handlers/fact、
  api/handlers/reference、services/systemPrompt（OS-142 未约束的面，直引保留）＋协议层转供面
  protocol/index、protocol/kernelPlumber、protocol/hostWrite、protocol/chapters、
  protocol/factGuard（S2.4 的 KERNEL_GATEWAY_ALLOW 显式豁免清单）。模块层
  （deduceEngine/libraryManage/projectDoc/importAdapter）与 services/enrichEngine 自 OS-142
  起改经协议层 `fact` 命名空间取，不再直引本文件。
- **不在管辖**：worldbook 格式契约（vendor/contracts/worldbookFileContract.js）是格式契约面，
  OS-142 起模块层经 src/protocol/worldbookContract.mjs 转供取用（护栏测试仍直引 vendor 本体），
  不经 adapter（解耦规划 §4「不动」）。
- **边界**：内核换版本/换实现只改这一个文件；新模块一律走协议层 fact 命名空间（即五组出口），
  不得绕行。

### L2 core/pinax（fact 链底座，逐字 vendor）

逐字 vendor 自 Pinax-next `feat/pinax-electron-next`@`70a4f44`，**本仓禁改**。按能力分：

| 能力 | 文件 |
|---|---|
| 存储协议 | `next/kernel/factFileStore.mjs`（真源 `<库>/拆解/<id>.json`，`fact.data/v3`，revision＋operationId 幂等＋expectedRevision 乐观并发）、`next/kernel/errors.mjs`、`next/fs/atomicWrite.mjs`（被引方：`electron/projects/fsDurability.mjs` 的 fsync 耐久化链） |
| 推演端子 | `next/fact/usecases/deduce/`（opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState）＋ `next/fact/usecases/factPack.js` |
| enrich 度量 | `next/fact/usecases/enrich/{metrics,pseudoChapters}.mjs`（因果图闭环率/耦合度/断点敏感度＋伪章推导） |
| 领域词表 | `next/fact/domain/`（aliases/pediaSchema/perspective/schema/stableId/status/validity/vocabulary）＋ `next/kernel/wikiDerive.mjs` |

- **出处与漂移**：`core/VENDORED.md`（映射＋解耦史）；sha256 指纹锚
  `core/.vendored-manifest.json`（双段：pinaxNext＋pinaxCore，逐文件），
  `npm run vendor:check` 逐文件比对。
- **另有收编件**：`vendor/contracts/worldbookFileContract.js`（OS-132 收编自 @pinax/core
  0.16.0＝pinax-core 仓 `e56a0bc`，不在 core/pinax 之内，同受「禁改」约束）。
- **边界**：core 里的文件不 import 本仓任何模块；改动只发生在上游，再同步进本仓。

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

## 升级上游内核的标准动作

内核（Pinax-next 的 `next/**`、`electron/projects/fsDurability.mjs`；pinax-core 仓的
`worldbookFileContract.js`）升级时的固定三步：

1. **`npm run vendor:check`**（`scripts/vendor-drift.mjs check`）——先分清现状：
   `[本仓被改]`＝红线被踩，先回滚本仓改动；`[上游已变]`＝上游在锚 `70a4f44`/`e56a0bc`
   之后动过，逐文件评估要不要跟；`[上游已移位]`＝信息级（上游没这文件，本仓有意保留）。
2. **看 pinaxAdapter.mjs**——消费面只有五组出口＋plumber。上游改了什么能力，先落到
   `factStore/deduce/enrich/projectMeta/projectImport` 五组里评估波及面（消费方只有上面点名的那几个），
   破坏性变更在 adapter 内消化，不让消费方跟着改。
3. **重 vendor**：改上游 → 重跑 `scripts/vendor-deduce.mjs`（`core/pinax/next/fact/**`
   递归闭包）／重收编 `vendor/contracts/` → `node scripts/vendor-drift.mjs snapshot`
   重建指纹锚 → 全量测试＋门禁。
   **不要跑 `scripts/vendor-core.mjs`**——其 SEEDS 表已随 OS-123/124 删除面过时，
   重跑会把已删层拉回仓（VENDORED.md OS-124 节）。

## 跨层红线

1. **`core/**` 与 `vendor/contracts/**` 内容禁改写**——vendor 件的改动发生在上游，
   本仓只同步（sha256 指纹锚盯着，`npm run vendor:check` 即验）。
2. **`project.json` 与 fact schema（`fact.data/v3`）是跨仓契约**——与 Pinax 桌面端
   双向兼容：spec `pinax-project@3`、schemaVersion 3、字段名与顺序、carriers 结构、
   fact 条目形状，一个字节不许变（金样护栏 `test/decoupleStep2.test.mjs`、
   `test/decoupleStep1.test.mjs`）。
3. **S2.4 唯一进口**：src/ 模块与仓根垫片里只有 `src/kernel/pinaxAdapter.mjs` 可以 import `core/**`
   （门禁静态扫描钉死）；protocol/** 对 pinaxAdapter 的转出＝显式豁免清单（OS-142，
   门禁 KERNEL_GATEWAY_ALLOW 点名，新增转供文件先补名单）。`vendor/contracts/` 是格式契约面
   例外：模块层经 `src/protocol/worldbookContract.mjs` 转供取用，护栏测试直引 vendor 本体。
4. **依赖只许向下**（L7→L6→L5→L4→L3→L2→L1 单向）；Pinax 从不 import OpenStory。
5. **daemon 来源防护闸不许拆**（OS-136）：Host／Origin／Sec-Fetch-Site 三道闸＋强制 JSON
   content-type 是「作者浏览器里的任意网页写不进本机 daemon」的纵深防线；所有端点（含
   `fsBrowse` 这类本机目录浏览）默认吃闸，不做绕行后门。本地进程本来就能直接读盘，
   不加目录白名单——OS-110/119 的「任意磁盘目录建库」行为不变。

## 插件生态（三层货架，协议各自成文）

| 层 | 协议 | 管什么 | 注册方式 |
|---|---|---|---|
| 业务套件 | [PROTOCOL.md](./PROTOCOL.md)（openstory-suite@2） | 业务域默认规则＋独立设置页＋（未来）业务页/工作流 | 目录＋manifest；capabilities 能力声明；宿主按声明加载 |
| Agent 运行时 kit | openstory-runtime-kit@1（`openstory/runtimes/README.md`） | 模型对话通道（sidecar/endpoint） | 目录＋manifest；chat 面＝OpenAI 兼容 SSE |
| 风格包 | tokens JSON | 整窗换肤＋栅格密度 | 目录＋tokens |

共同规则：**本机目录按 id 覆盖内置**；坏档跳过＋warning 不拖垮货架；停用＝规则退回内置默认
（值保留）；凭据只存本机。能力白名单见 OS-129（插件能力白名单，services 声明对齐宿主真实实现）。

## 与 Pinax 的关系

- 同一份文件资产、两个壳：Pinax（Electron 深度形态）与 OpenStory（浏览器轻形态）。
- 内核关系（OS-123→132 解耦后）：`core/pinax` 全树＋`vendor/contracts` 逐字 vendor
  （Pinax-next@`70a4f44`、@pinax/core 0.16.0＝`e56a0bc`），经 pinaxAdapter 单点消费；
  建库/导入/章节号/载体映射已自持（projectDoc/importAdapter/textUtil，fork 点不再随上游同步）；
  上游漂移由 `npm run vendor:check` 监控。依赖方向恒为 openstory→core，Pinax 从不 import OpenStory。
- 两侧设置互不干扰：OpenStory 的套件/运行时/风格配置全部只存本机 openstory 目录。

## 演进约定

- 契约先行：API 变更先改 `src/api/contracts/<域>.mjs`（OS-130 分域，端点总数见生成表），两端一起跟。
- 每批「界面上能看到新东西」；demo 数据退役一批、真数据上位一批。
- 插件协议升级走 schemaVersion（@2 起精确匹配＋@1 兼容读），不做半懂兼容。
- 遗留与明确不做的事项见 [docs/LEGACY-ITEMS.md](./docs/LEGACY-ITEMS.md)，不在本文重复。
