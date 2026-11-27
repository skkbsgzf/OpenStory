# OpenStory 架构

> OS-150 起规模数字由脚本生成；OS-173/C6 起不再使用 L7–L2 旧分层口径。
> 当前按**底座、契约、协议、模块角色、服务/资源、前端与磁盘库**描述职责。
> 本文所有文件数/行数只出现在 `arch-stats:start` … `arch-stats:end` 生成段：
> `tools/arch-stats.mjs` 直接扫描源码与 `module.manifest.json`，不执行模块 `activate`。
> 改目录或行数后运行 `npm run arch:stats`；`node tools/arch-stats.mjs --check` 与验收 S0.2 逐字比对。
> 物理行按 CRLF／LF／CR 归一，空行与注释计入，末尾换行不额外计一行。

## 数据优先级（一级公民声明）

**见 [FACT-FIRST.md](docs/FACT-FIRST.md)。** 一句话：

```
① 事实链 fact entries（事件/人物/设定/关系/因果图/需求层级/台账）
② 正文 chapters（.md 原文）
③ 派生物 wiki 快照 / RAG 索引 / 推演会话
```

事实链是正文的**结构化投影**，每条事件都带 `sources[]`（源文件＋段号＋quote_hash）可回指原文。
读数据先问事实链，喂模型先问能否只喂事实链；正文用作出处与兜底。任何绕过
`factStore`/`fact.store` 写协议直接改事实链的做法都算违约。

## 职责地图与依赖方向

```
前端 public/ ─HTTP→ 契约 src/api/ ─分派→ 底座 src/host/
                                          │
                          协议 src/protocol/ + 能力句柄
                                          │
                 ┌────────────────────────┼─────────────────────┐
                 ▼                        ▼                     ▼
          内核件模块                 工作台模块            服务/套件资源
       src/modules/*（kernel）    src/modules/*（workbench）       │
                 └──────── 物理写管道 src/kernel/ ──────────────┘
                                          │
                                      本地磁盘库
```

这不是一条“文件越靠下越可信”的旧层号，而是运行时边界：

- **底座**只拥有进程/网络、装载与动态入口、契约壳、物理写管道、命名投影五类不可替代职责。
- **契约**冻结外部 endpoint id、路径、请求/响应形状与错误信封；内部模块改名不得改端点或 MCP 工具名。
- **协议与能力句柄**是模块间唯一消费面。明确的兼容转供叶可以 re-export，不得复制实现。
- **内核件模块**只提供带主版本的能力；不得拥有 endpoint、page、slot 或设置界面。
- **工作台模块**声明 hard/optional requires、pages/slots 与独占 endpoints，并经 `activate` 登记贡献。
- **服务与套件资源**实现外围适配或提供声明式数据，不反向拥有工作台 UI。
- **磁盘库**是唯一持久真相；浏览器只保存内存视图，未确认草稿/推演态同样落本地。

下面是**生成段**：不要手改数字。内核件、工作台、套件模块与宿主组合面按各自 manifest 的
`class` 分组；`agentbar`/`library` 是无 class 的恒启宿主组合面，单列统计。

<!-- arch-stats:start -->
| 分工 | 范围 | 文件数 | 行数 |
|---|---|---:|---:|
| 底座 | `src/host/`＋`src/kernel/` | 28 | 6,503 |
| 契约 | `src/api/` | 19 | 4,324 |
| 协议 | `src/protocol/` | 36 | 7,263 |
| 内核件（class: kernel，8） | `src/modules/agent-runtime/`＋`src/modules/deduce/`＋`src/modules/fact/`＋`src/modules/knowledge-runtime/`＋`src/modules/media/`＋`src/modules/prose/`＋`src/modules/storage/`＋`src/modules/text/` | 63 | 12,041 |
| 工作台（class: workbench，13） | `src/modules/analysis/`＋`src/modules/artifacts/`＋`src/modules/chapters/`＋`src/modules/exchange/`＋`src/modules/habits/`＋`src/modules/imagegen/`＋`src/modules/knowledge/`＋`src/modules/knowledge-base/`＋`src/modules/log/`＋`src/modules/roleplay/`＋`src/modules/script/`＋`src/modules/storysource/`＋`src/modules/worldbook/` | 41 | 5,187 |
| 宿主组合面（恒启） | `src/modules/agentbar/`＋`src/modules/library/` | 5 | 1,172 |
| 套件模块（class: suite） | `src/modules/` | 0 | 0 |
| 服务 | `src/services/` | 7 | 1,905 |
| 套件资源 | `suites/`＋`styles/`＋`runtimes/`＋`genres/`＋`skills/` | 62 | 3,284 |
| 设计令牌 | `design-system/` | 3 | 138 |
| 前端 | `public/` | 37 | 22,039 |
| 磁盘库 | 库＝文件夹（无代码） | — | — |

| 附加指标 | 实测 |
|---|---:|
| `public/app.js` 行数 | 10,047 |
| `public/views/*.mjs` 文件数 | 19 |
| 契约端点数（`ENDPOINTS` 键数） | 129 |
| 测试文件数（`test/*.test.mjs`） | 139 |

**模块清单（由 `src/modules/*/module.manifest.json` 自动生成）**

| id | 角色 | 独占端点数 | 页签/入口 | manifest `settings` 项数 |
|---|---|---:|---|---:|
| agent-runtime | kernel | 0 | — | 0 |
| agentbar | host-composition | 0 | — | 0 |
| analysis | workbench | 0 | analysis | 0 |
| artifacts | workbench | 1 | artifacts | 0 |
| chapters | workbench | 7 | chapters | 0 |
| deduce | kernel | 0 | — | 0 |
| exchange | workbench | 2 | exchange | 0 |
| fact | kernel | 0 | — | 0 |
| habits | workbench | 2 | habits | 0 |
| imagegen | workbench | 2 | imagegen | 0 |
| knowledge | workbench | 4 | knowledge | 0 |
| knowledge-base | workbench | 12 | knowledge-base | 0 |
| knowledge-runtime | kernel | 0 | — | 0 |
| library | host-composition | 0 | — | 0 |
| log | workbench | 0 | log | 0 |
| media | kernel | 0 | — | 0 |
| prose | kernel | 0 | — | 0 |
| roleplay | workbench | 18 | roleplay | 0 |
| script | workbench | 2 | script | 0 |
| storage | kernel | 0 | — | 0 |
| storysource | workbench | 0 | storysource | 0 |
| text | kernel | 0 | — | 0 |
| worldbook | workbench | 7 | worldbook | 0 |

合计 23 份 manifest（8 kernel + 13 workbench + 2 host-composition）；57 个模块独占端点，72 个宿主自有端点，端点覆盖 129/129。
kernel 能力声明：agent.runtime@1 / deduce.engine@1 / fact.store@3 / fact.pack@1 / fact.enrich@1 / fact.engine@1 / fact.books@1 / fact.write@1 / fact.domain@1 / knowledge.retrieval@1 / media.generate@1 / media.describe@1 / prose.write@1 / storage.roots@1 / library.list@1 / storage.scaffold@1 / storage.inventory@1 / text.analyze@1。
`app.js` 当前上限 10,500 行（只降不升），当前实测 10,047 行。
<!-- arch-stats:end -->

## 底座 `src/host/` ＋ `src/kernel/`

### 进程与网络 `src/host/`

- `daemon.mjs` 以 node:http 手写路由，只监听 `127.0.0.1`；入口由实现文件直跑，仓根零 `.mjs`。
- 单实例锁、stamp、generation 与 `/api/health` 构成进程事实；缺业务能力不阻止 health。
- 来源防护保持四道闸：Host、Origin、Sec-Fetch-Site，以及带 body 时强制 JSON content-type。
  错误码 `FORBIDDEN_ORIGIN`（403）与 `UNSUPPORTED_MEDIA_TYPE`（400）不随模块改动。
- `mcp.mjs` 是 stdio JSON-RPC 到 daemon HTTP 的薄适配层；数据操作仍走 daemon，不套 agent 对话。
- 旧库一次性升级只对请求中显式指定且已授权的 root 执行：先备份，再迁移，失败按 journal
  回滚，成功后旧目录改名留档；运行态不维护 `.pinax/` 与 `.openstory/` 长期双读。

### 装载与动态激活

- `src/protocol/modules.mjs` 校验 manifest、固定内置来源与阶段：测试/迁移可显式 stage B；
  生产装载使用 stage C，class 与 class 专属字段不得缺省，任意 `core` 字段拒绝。
- `src/protocol/capabilityGraph.mjs` 对候选图执行闭环、冲突、覆盖合法三检查；启停事务先验证
  候选快照再提交。hard 依赖缺失不拖死 daemon，消费者降级；主动停用仍是 `MODULE_DISABLED`（409）。
- `src/host/moduleLoader.mjs` 校验 entry 不逃逸包目录、必须导出 `activate`，再以能力上下文调用。
- `src/protocol/moduleActivation.mjs` 校验贡献键只能为 capabilities/handlers/pages/settingsConsumers；
  未声明贡献不得注册。验收 S2.7 在独立进程真实激活全部内置模块，不用静态字符串冒充动态验证。
- `src/protocol/capabilityImplementations.mjs` 是统一能力实现注册表；宿主组合根只允许显式绑定，
  不允许用私有 fallback 掩盖漏登记。`src/protocol/capabilityResolver.mjs` 提供绑定不可变快照的薄代理。

### 物理写管道 `src/kernel/`

`src/kernel/` 是 OpenStory 自持的物理内核，身份 `openstory-kernel@1`。它于 OS-152→157
由 Pinax-next `feat/pinax-electron-next@70a4f44` 分批转为自有；`core/`、`vendor/` 与旧同步流程已退役。
保留真实出处，不再宣称桌面端互认或上游同步。

| 组 | 职责 |
|---|---|
| 公开面/身份 | `index.mjs` 五键 `factStore/enrich/ok/fail/writeFileAtomic`；`identity.mjs` 固定内核身份 |
| 管道件 | `errors.mjs`、`atomicWrite.mjs`、`fsDurability.mjs`：统一失败载荷、原子写、fsync/rename/目录 fsync 与失败清场 |
| fact 链 | `fact/factFileStore.mjs`、wikiDerive、factPack、domain：事实写协议、派生、稳定 id 与状态机 |
| enrich | 伪章推导与因果图度量等纯只读函数 |

写协议只经 `factFileStore.writeFactFile`；物理提交只经统一写管道。协议兼容转供叶可直取
公开面或管道件，但不得复制函数体。内核不得反向 import 协议或业务模块；当前边界债由 S2.4'
逐文件报告，不能以“暂存”为由静默豁免。

### 底座能力句柄

`src/host/baseCapabilities.mjs` 提供五项只读/受控句柄：

| 能力 | 职责 |
|---|---|
| `base.process` | lock/stamp/generation/health/jobs/events/SSE |
| `base.loader` | manifest 校验、源发现、图检查、动态激活与启动报告 |
| `base.contract` | endpoint 分派、请求/响应形状、统一错误信封 |
| `base.write` | 原子写、临时文件、备份钩子、journal 物理提交 |
| `base.naming` | 正名/slug/目录/日志/slot 的只读投影 |

## 契约 `src/api/`

- `contracts.mjs` 聚合 library/chapters/fact/reference/agent/plugins/system/exchange 八域分片，
  是 API 形状唯一真源；端点数取 `ENDPOINTS` 键数，与 S2.3 同口径。
- `registry.mjs` 以 endpointId 登记 handler；`handlers/` 提供八域业务实现。
- 契约壳拥有 endpoint id/path、HTTP 映射和统一错误信封，不拥有插件内部实现。
- 业务 handler 必须经协议转供或能力句柄消费模块；当前直接 import 的边界债由 S2.1 点名。
- 前端与 daemon 共享同一契约；MCP 工具名、外部错误码字符串不随内部 slug 改名。

## 协议 `src/protocol/`

协议层是宿主与模块之间的稳定消费面，不是业务实现的复制区。

- `capabilityImplementations.mjs` 是唯一静态实现登记表；`host-api@2` 第二套命名空间入口已在
  OS-195b 退役，键清单与「转出不换实现」断言迁到 `test/hostApi.test.mjs` 的能力面快照。
- 文件协议包括 chapters/chapterWrite/changelog/libState/hostWrite/libraryManifest/libraryUpgrade。
- 治理协议包括 modules/capabilityGraph/capabilityResolver/capabilityImplementations/moduleActivation/
  capabilityBindings/dependencyGraph/versionGate/plugins/naming。
- OS-195b 后协议层零转供叶：FACT-FIRST 守卫归 `src/modules/prose/`，运行时 sidecar 归
  `src/modules/agent-runtime/`，裸包名依赖由 `package.json` 声明并在模块内直接 import；
  `shelfManifests.mjs` 只提供货架清单的底座只读口。S2.1 比较实现体，拒绝复制。
- `naming.mjs` 当前仍从 `public/views/registry.mjs` re-export。它是迁移态，不构成第二真源；
  词表最终归属由 ADR 0002 的 D 批裁定，当前不提前宣称已完成迁移。

## 模块角色 `src/modules/`

### 七内核件（manifest `class: kernel`）

内置内核件按能力域划分为 `storage/fact/prose/text/deduce/agent-runtime/media`。
它们与 `src/kernel/` 物理管道不是同一概念：前者是带版本的业务能力供给者，后者是统一失败/写盘基础设施。

- 只声明 `capabilities` 与能力依赖；不声明 endpoints/pages/slots/settings/settingsHint/settingsJump。
- `entry` 导出 `activate`，返回的 capability 句柄必须与 manifest 逐项对应。
- 能力主版本变更代表不兼容；改变格式或确定性结果必须带新金样，覆盖者不得冒充原金样。
- 模块间禁止直接 import；只能经协议转供叶或 `context.resolve()` 获取稳定句柄。

### 工作台（manifest `class: workbench`）

- 声明非空 `requires` 与 `slots`，pages 只保存 id/label，嵌入点只在 slots 写 `{slot,page}`。
- 独占 endpoint 必须登记在 manifest；共用 fact 读不登记，停用任何工作台不得让共用读失效。
- `activate` 的 handlers/pages/settingsConsumers 必须与声明一致；设置键必须有真实消费者。
- `agentbar` 与 `library` 不是 workbench，不接受模块启停键，也不渲染成普通工作台开关。
- 套件模块（`class: suite`）只提供 supplies/entries/resources 等声明式数据；当前内置清单若无该类，
  生成段会显示 0，不以货架数量冒充 module@2 suite 数量。

### 设置与启停

模块设置值落 `<库>/.openstory/ui-state.json` 的 `modules.settings.<id>.<key>`；套件设置落
`<库>/.openstory/plugins/suite-state.json`。停用不删稿件、设置或历史。

OS-146 铁律继续有效：界面设置项必须有真实消费者。生图/识图真源在本机 agent-config.json，
知识库真源在本机 kb-config.json，右栏卡片开关是 ui-state `analyzeEnabled`；不得在设置页再摆一份。
`public/views/settingsAggregation.mjs` 是零 import 的聚合/渲染纯函数，`app.js` 只取数调用。

## 服务与套件资源 `src/services/` 及资源目录

- 服务提供 embedding、CLI/DSH 桥、模型配置、任务中心、原生选择器、同步检查、语义富化与货架扫描等外围能力。
- 资源目录 `suites/`、`styles/`、`runtimes/`、`genres/`、`skills/` 与 `src/services/` 的实现分别计数。
- 业务套件、runtime kit、风格包仍是既有货架协议；新 `module@2 class:suite` 禁止宿主可执行代码。
  legacy page 模式的 `.html/.mjs/.js` 继续隔离，不贴新协议标签，不开放第三方执行。
- 本机货架不得静默覆盖内置；显式 override 必须过版本对齐、迁移责任与回退链守卫。
- 凭据只存本机，响应只回掩码；服务不得把密钥或内部绝对路径写入库内日志。

## 前端 `public/`

- 原生 ES 模块、零 npm 构建；`index.html` 的 `:root` 是颜色与字号令牌真源，并同步
  `design-system/tokens.css`。功能轨与正文轨分离，页面不得自造字号/颜色体系。
- `views/registry.mjs` 是页签/路由声明注册表与 `NAMING_TABLE` 唯一真源；词表外目录不出页签，
  退场目录无条件过滤。`app.js` 是只减不增的消费壳，视图渲染函数只出不进。
- `app.js` 当前硬上限与实测见生成段；`tools/number-anchors.mjs` 同时保存历史“只降不升”断言。
- 新 UI 只用 `.uikit-*` 与全局令牌；多值输入用 chipField。窄面板必须在 675px 与 420px 自查，
  ≤1000px 左右栏回覆盖抽屉，正文可读下限 `--doc-read-min` 不被压缩。
- 前端只经 HTTP 契约与 daemon 说话，不把内容性/状态性数据放入 localStorage/sessionStorage/IndexedDB。
- `echarts` 本地运行库在 `public/vendor/`，不计入前端源码规模；设计令牌单独成行。

## 磁盘库——文件即真相

库是文件夹，无数据库。运行态唯一为 `<库>/.openstory/`；读侧只认新布局，不做长期双读。

| 位置 | 内容 |
|---|---|
| `正文/NNN-标题.md`、`剧本/`、`世界书/` | 稿件；旧 `参考/` 只在升级时迁入 `世界书/` |
| `故事源/<bookId>.json` | fact 真源 `fact.data/v3` ＋ `*.wiki.json` 派生 `openstory-wiki-derived@2` |
| `扮演/<bookId>/` | 主线/多局 session、active 指针、归档、导出与素材 |
| `导入导出/` | 导入与导出的落盘文件 |
| `.openstory/project.json` | `openstory-project@4`、schemaVersion 4、carrier＝`openstory.carrier.*` |
| `.openstory/drafts/<模块>/` | 作者正在编辑但尚未提交的草稿 |
| `.openstory/deduce/` | 未被采纳的推演拍/会话引擎态 |
| `.openstory/log/<模块>/<yyyy-mm>.jsonl` | append-only diff/log，模块加载时自检索 |
| `.openstory/ui-state.json` | 页签、模块开关、选中项、字号等界面状态 |
| `.openstory/plugins/suite-state.json` | 随库走的套件启停与设置 |
| 同目录 `.history/` | 写前二进制备份；每文件配额＋日锚＋最新保护，删除留痕 |
| `.history/upgrade-<时间戳>/` | 旧库一次性升级前整库备份 |
| `<旧目录名>.retired-<时间戳>/` | 升级成功后退役留档，不参与运行 |
| `.openstory/upgrade.json` | 升级报告与幂等标记 |
| `%LOCALAPPDATA%/OpenStory/libraries.json`（不入库） | OpenStory 自持库清单；库身份仍靠库内 project.json |
| `%LOCALAPPDATA%/OpenStory/openstory/`（不入库） | agent-config.json、daemon.lock、机器级界面偏好与本机货架 |

旧库升级按“备份 → 运行态 → 目录 → 状态键名 → 项目标记 → 派生 schema → 存量路径 → 升级标记”
执行；目录映射为 `参考/→世界书/`、`拆解/→故事源/`、`推演/→扮演/`、`导出/→导入导出/`。
项目/carrier/wiki/临时前缀归一到 OpenStory 谱系名，同名冲突加升级后缀。测试只使用临时
`LOCALAPPDATA` 与临时夹具库，不读作者真库或真院子。

## 门禁与演进纪律

1. **S2.1 能力路由**：模块只经协议/能力句柄消费；API/services/host/protocol 的直连只允许
   点名声明的兼容转供叶，并用函数体比较拒绝实现复制。
2. **S2.4' 底座边界**：`src/kernel/` 不得反向 import 协议/模块；host 只允许显式组合绑定；
   `core/`/`vendor/` 路径不得回潮；物理写实现不得在底座外复制。
3. **S2.7 能力归属**：stage-C 覆盖、kernel 零 UI/端点、workbench entry/requires/slots、端点唯一归属、
   能力图无错误，以及独立进程动态激活/贡献校验必须同时通过。
4. **磁盘格式冻结**：`.openstory/project.json`＝`openstory-project@4`、`故事源/*.json`＝`fact.data/v3`、
   `*.wiki.json`＝`openstory-wiki-derived@2`、`.openstory-tmp-*`。变更须连金样与迁移夹具一起评估。
5. **每笔写操作可追溯**：统一写通道生成 `.history` 备份，`recordChange()` 计算 unified diff 并追加月度日志。
6. **外部名字不漂移**：endpoint id/path、MCP 工具名与既有错误码不随内部结构调整；要改另立兼容工单。
7. **门禁失败不伪装完成**：动态注册缺项、hard require 未解析或 src 边界债必须在报告中逐项保留，
   不得改测试口径换取绿灯。

## 插件生态与历史出处

| 货架 | 协议 | 职责 |
|---|---|---|
| 业务套件 | `openstory-suite@2` | 业务规则、独立设置页与 legacy 页面/工作流 |
| Agent runtime kit | `openstory-runtime-kit@1` | sidecar/endpoint 命令描述；执行适配归 agent-runtime |
| 风格包 | tokens JSON | 整窗换肤与栅格密度 |

逐文件“来源 → 现位置”见 `docs/kernel-provenance.md`。内核最初出自 Pinax-next
`feat/pinax-electron-next@70a4f44`，世界书文件契约出自 `@pinax/core` 0.16.0；这些只作真实出处。
OS-172 后 OpenStory 与 Pinax 桌面端没有互认协议、共享运行态或清单导入通道。旧库与旧格式
只作一次性迁移源；旧院已完全不参与运行（OS-189）。历史决策文档保留裁定过程，不把其中的
旧数字重新解释为当前事实。

架构裁定与协议见 [ADR 0002](docs/adr/0002-base-constitution.md)、
[module-manifest@2](docs/protocol/module-manifest-2.md)；遗留与明确不做事项见
[docs/LEGACY-ITEMS.md](docs/LEGACY-ITEMS.md)。
