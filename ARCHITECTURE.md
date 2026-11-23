# OpenStory 架构

> 七层实测分层（OS-133 归档）。所有数字实测于 2026-11-23（`wc -l` / `node --test` /
> `tools/acceptance/acceptance.mjs`），不是抄的——下次动架构先重测再改这份文档。

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

```
L7  前端 public/            15 文件  19,917 行   无构建单页（浏览器/DSH webview）
L6  契约层 contracts/        8 文件   1,369 行   七域聚合，101 端点
L5  daemon（HTTP＋进程治理）  1 文件   5,298 行   node:http 手写路由＋OS-136 来源防护四层闸＋单实例锁/stamp/generation/health
    └ mcp.mjs（伴生进程）     1 文件     715 行   stdio 24 工具，daemon HTTP 的薄适配层
L4  本仓自持层              37 模块  10,733 行   建库/导入/fact 消费/参考/Agent/货架/协议层…
L3  pinaxAdapter.mjs         1 文件      60 行   内核唯一进口（五能力组）
L2  core/pinax              24 文件   4,332 行   fact 链底座（逐字 vendor，禁改）
L1  磁盘库                  ——        ——       文件即真相（库＝文件夹，.pinax 兼容）
```

### L7 前端 `public/` ——15 文件 / 19,917 行

- **职责**：工作台单页（无构建、原生 ES 模块）。`index.html`（2,756 行，样式令牌 `:root`
  单一真源）＋ `app.js`（12,529 行，路由/页签/左列 Agent）＋ 13 个零依赖模块
  （analysis/analysisModules/charts/graph/md/reference/referenceStore/script/scriptFact/
  scriptFormat/storySource/storyTree/ui-kit）；echarts 本地 vendor（`public/vendor/echarts.min.js`）。
- **边界**：只经 HTTP 契约（L6）与 daemon 说话；不落任何内容性/状态性数据（OS-89，
  浏览器只做内存视图）；前端模块互不 import（门禁 S2.2，md.mjs 渲染协议除外）。

### L6 契约层 `contracts/` ——8 文件 / 1,369 行 / 101 端点

- **职责**：API 形状唯一真源（OS-130 契约分域）。`contracts.mjs`（221 行）聚合七域分片：
  library(6) / chapters(12) / fact(27) / reference(7) / agent(17) / plugins(10) / system(22)
  ＝ **101 端点**（`ENDPOINT_LIST` 实测 101）；请求/响应双端校验，daemon 与前端共享同一份。
  错误码词表含 OS-136 来源防护两码：`FORBIDDEN_ORIGIN`（Host/Origin/Sec-Fetch-Site 拒收，403）、
  `UNSUPPORTED_MEDIA_TYPE`（带 body 非 JSON，400）。
- **边界**：纯数据＋纯函数，零依赖（不 import node:path/fs，浏览器也能载入）；
  改形状＝改对应域分片，两端一起跟。

### L5 daemon ——daemon.mjs 1 文件 / 5,298 行（＋mcp.mjs 伴生进程 715 行）

- **职责**：node:http 手写路由，只监听 127.0.0.1:8807（`DEFAULT_PORT` daemon.mjs:157）。
  endpointFor 契约分派＋validateResponse 响应校验；**唯一磁盘写入面**（原子写＋.history
  备份）；SSE 通道；**OS-136 来源防护四层闸**——①Host 闸全局生效（只认
  `127.0.0.1/localhost/[::1]`＋实际绑定端口，防 DNS 重绑定）；②Origin／③Sec-Fetch-Site
  两道闸管全部 `/api`（只放行本机回环源与 same-origin/none；不带 Origin 的本机进程——
  node fetch/curl/mcp.mjs——不受影响）；④带 body 必须 application/json（跨站
  text/plain 简单请求从此写不进来；`FORBIDDEN_ORIGIN`=403、`UNSUPPORTED_MEDIA_TYPE`=400，
  专项测试 `test/originGuard.test.mjs`）；**OS-127 进程治理**——单实例锁
  （`%LOCALAPPDATA%/PinaxNext/openstory/daemon.lock`）、acquire/stamp/clear 三步闸、
  generation 代际继承、`/api/health` 读 DAEMON_RUNTIME。
- **伴生进程**：`mcp.mjs`（715 行，stdio JSON-RPC，**24 工具**）是 daemon HTTP 的薄适配层
  ——数据操作全部转发本机 daemon，唯一直算例外是 analysis 纯函数；不套娃（不开 agent 对话）。
- **边界**：业务逻辑下沉 L4；daemon 只做分派、校验、落盘与进程治理。

### L4 本仓自持层 ——37 个仓根模块 / 10,733 行

OS-123/124 解耦后，建库/导入/章节号解析全部自持，不再 vendor。按职责组（行数实测）：

| 组 | 模块（行数） |
|---|---|
| 建库与导入（OS-123/124 fork 点） | projectDoc(563，建库＋project.json 合同) / importAdapter(582，整目录导入) / textUtil(97，章节号＋世界书契约判定) / libraryManage(298) |
| fact 消费与校验 | enrichEngine(828，语义富化 6 窗) / factGuard(257) / deduceEngine(332，推演核封装) / deduceSession(496，多局会话容器) / deduceNarrative(159) / dependencyGraph(162，因果依赖图) / syncCheck(247，正文↔拆解一致性) |
| 协议层（S2.1 白名单公共面） | chapters(191，读写协议) / changelog(385，diff＋月度 jsonl) / versionGate(110，插件版本闸) / plugins(161，三货架只读聚合) |
| 参考/世界书 | referenceStore(609，标签/双链/图谱) |
| Agent | agentStore(488) / agentEvents(356，AG-UI canonical 事件模型＋SSE 投影) / roleplayEngine(280) / roleplayPrompts(188) |
| 插件货架 | suites(459) / skills(323) / runtimes(314) / genres(287) / stylePacks(119) |
| 引擎与周边 | comfyEngine(198 生图) / kbAdapter(222) / kbHealth(181) / kbRouter(131) / libState(191) / jobCenter(171 任务中心) / nativePicker(131) / dsh-bridge(396) / dsh-cli(392) / embedding-server(150) / cli-bridge(112) / style-check(167) |

- **边界**：模块间禁止直接 import（门禁 S2.1）——只经协议层（chapters/changelog/versionGate/
  plugins/pinaxAdapter）与 L3 进口；内核能力只从 L3 的五组出口取。

### L3 pinaxAdapter.mjs ——1 文件 / 60 行（内核唯一进口）

- **职责**（OS-125 解耦③）：全仓唯一允许 import `core/**` 的仓根模块（门禁 S2.4，
  41 个仓根模块扫描）。**五能力组出口**：
  `factStore`（S1 只读 list/get ＋ S2 writeFactFile 写协议）、`deduce`（opening/turn/settle
  端子）、`enrich`（伪章推导＋因果图三指标）、`projectMeta`（转引本仓 projectDoc）、
  `projectImport`（转引本仓 importAdapter/textUtil）；后两组是自有能力的统一出口。
  另有最小补集 plumber（`ok`/`fail`/`writeFileAtomic`）仅限 projectDoc/importAdapter
  两个既有 fork 点使用。
- **消费方**（实测 import 本文件的）：chapters / daemon / deduceEngine / enrichEngine /
  factGuard / importAdapter / libraryManage / projectDoc，共 8 个。
- **不在管辖**：worldbook 格式契约（vendor/contracts/worldbookFileContract.js）是格式契约面，
  textUtil 直引，不经 adapter（解耦规划 §4「不动」）。
- **边界**：内核换版本/换实现只改这一个文件；新模块一律走五组出口，不得绕行。

### L2 core/pinax ——24 文件 / 4,332 行（fact 链底座，逐字 vendor）

逐字 vendor 自 Pinax-next `feat/pinax-electron-next`@`70a4f44`，**本仓禁改**。按能力分：

| 能力 | 文件 |
|---|---|
| 存储协议 | `next/kernel/factFileStore.mjs`（真源 `<库>/拆解/<id>.json`，`fact.data/v3`，revision＋operationId 幂等＋expectedRevision 乐观并发）、`next/kernel/errors.mjs`、`next/fs/atomicWrite.mjs`（被引方：`electron/projects/fsDurability.mjs` 的 fsync 耐久化链） |
| 推演端子 | `next/fact/usecases/deduce/`（opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState，8 文件）＋ `next/fact/usecases/factPack.js` |
| enrich 度量 | `next/fact/usecases/enrich/{metrics,pseudoChapters}.mjs`（因果图闭环率/耦合度/断点敏感度＋伪章推导） |
| 领域词表 | `next/fact/domain/`（aliases/pediaSchema/perspective/schema/stableId/status/validity/vocabulary，8 文件）＋ `next/kernel/wikiDerive.mjs` |

- **出处与漂移**：`core/VENDORED.md`（映射＋解耦史）；sha256 指纹锚
  `core/.vendored-manifest.json`（双段：pinaxNext 24 文件＋pinaxCore 1 文件），
  `npm run vendor:check` 逐文件比对。
- **另有收编件**：`vendor/contracts/worldbookFileContract.js`（OS-132 收编自 @pinax/core
  0.16.0＝pinax-core 仓 `e56a0bc`，不在 core/pinax 24 文件之内，同受「禁改」约束）。
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
| `<同目录>/.history/` | 每版写前备份（二进制快照） |
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
   `factStore/deduce/enrich/projectMeta/projectImport` 五组里评估波及面（消费方仅 8 个模块），
   破坏性变更在 adapter 内消化，不让 8 个消费方跟着改。
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
3. **S2.4 唯一进口**：仓根模块里只有 `pinaxAdapter.mjs` 可以 import `core/**`
   （门禁静态扫描钉死）；`vendor/contracts/` 是格式契约面例外，仅 textUtil 及其护栏测试直引。
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
- 内核关系（OS-123→132 解耦后）：`core/pinax` 24 文件＋`vendor/contracts` 1 文件逐字 vendor
  （Pinax-next@`70a4f44`、@pinax/core 0.16.0＝`e56a0bc`），经 pinaxAdapter 单点消费；
  建库/导入/章节号/载体映射已自持（projectDoc/importAdapter/textUtil，fork 点不再随上游同步）；
  上游漂移由 `npm run vendor:check` 监控。依赖方向恒为 openstory→core，Pinax 从不 import OpenStory。
- 两侧设置互不干扰：OpenStory 的套件/运行时/风格配置全部只存本机 openstory 目录。

## 演进约定

- 契约先行：API 变更先改 `contracts/<域>.mjs`（OS-130 分域，101 端点），两端一起跟。
- 每批「界面上能看到新东西」；demo 数据退役一批、真数据上位一批。
- 插件协议升级走 schemaVersion（@2 起精确匹配＋@1 兼容读），不做半懂兼容。
- 遗留与明确不做的事项见 [docs/LEGACY-ITEMS.md](./docs/LEGACY-ITEMS.md)，不在本文重复。
