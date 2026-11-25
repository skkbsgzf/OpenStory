# ADR 0002 · 底座宪法与三层半插件边界

**状态：架构方向已裁定；B1–B5、C 批、D1–D8 与清账批 OS-189～OS-199 已实施。动态装载在 OS-196 开放本机模块、OS-196a 返工（ADR 0003），slot 投影在 OS-198 接通前端。**

- 对应工单：[OS-173](../workorders/OS-173-base-constitution.md)
- 规划来源：[第三批规划](../plan/batch3-microkernel-plan.md) §1–§3
- 配套语言：[module-manifest@2 协议](../protocol/module-manifest-2.md)
- 前序裁定：[ADR 0001 · fact 数据源归一](0001-fact-schema-unification.md)（数据源结论继续有效；文中的旧路径与旧 schema 名是历史证据）

> **阅读口径**：§二至§六与§九是当前裁定，已按 2026-11-25 的实现逐行核对（OS-199）；§八是合并后的实施沿革，只保留过程事实，**现状以上文与生成数字为准**。历史段中的 14 模块、1 kernel、11,838 行等数字不代表当前状态；当前数字由 `ARCHITECTURE.md` 生成段与 `docs/number-anchors.json` 给出。作者已明确要求按既有细规划继续各批实现，不再等待旧工单逐项批准。动态装载已按 ADR 0003 的 G1–G5 开门并完成 OS-196／196a 返工；本机模块不是沙箱，信任模型照 AGENTS.md「本机模块」执行。

---

## 一、为什么现在需要这部宪法

当前实现已经具备模块 manifest、模块闸、能力白名单、货架依赖图和统一写通道，但它们还不是同一套协议：

- **B 批前基线**：`src/protocol/modules.mjs` 使用 `openstory-module@1`，以 `core:true` 表达四块不可停工作面，`uiStatePut` 返回 `MODULE_CORE`。B1–B3 已改为 @2、能力图事务并删除模块级 core／MODULE_CORE。
- `src/api/registry.mjs` 的 `HANDLERS` 是静态聚合，`ENDPOINT_MODULES` 在 import 时由 manifest 投影；没有能力路由表，也没有「重建—校验—原子切换」。
- `src/services/{skills,suites,runtimes,stylePacks,genres}.mjs` 各自扫描货架，后装载的同 id/name 直接覆盖先装载项；覆盖理由没有进入统一注册表。
- `src/protocol/index.mjs` 的 `host-api@2` 已有 fact/prose/changelog/jobs/events/plugins/guard 七个命名空间，但它是协议转供层，不是带主版本的能力图。
- `public/views/registry.mjs` 的 `NAMING_TABLE` 是显示名、目录名、日志模块名的唯一真源；`src/protocol/naming.mjs` 从浏览器侧 re-export，形成事实上的双端依赖。

因此，B 批不能先把 14 份 manifest 机械改个版本号。先确定「谁永远是裁判」「谁只能供给能力」「谁有权拥有界面」，后续升版、拆件、能力图和门禁才有同一把尺。

### 1.1 目标与不目标

**目标**：

1. 底座只保留五件宪法；插件分为 kernel / workbench / suite 三类。
2. 工作台只经能力协议消费内核件，不经 import 直连其他插件内部。
3. 落盘格式可以随能力升级，但物理写管道、备份、diff/log 和失败安全阀不可被插件绕过。
4. 插件坏掉、缺依赖或冲突时，daemon 仍能启动并提供 health；受影响工作面明确降级。
5. 前端显示名、插件名、机器 slug、库内目录名、日志模块名遵守三名一致。

**不目标**：

- 不在本单改代码、测试、manifest、门禁或规划文档。
- 不在本单开放第三方动态装载；D 批才评估本机 kernel/workbench 与第三方 suite。
- 不新建 demo。新 demo 只做《水浒传》、从 0 新建、优先级最低，是不属于第三批的独立项目。
- 不把历史出处声明当成品牌关联删除；`docs/kernel-provenance.md` 与 README 的「内核最初出自 Pinax-next」保留。

---

## 二、三名一致权威表

### 2.1 规则

1. **正名**就是前端显示名；设置页、右栏、库切换面板、页签标题不得另起同义词。
2. 正名在 `NAMING_TABLE` 对应唯一 slug；manifest `id`、模块目录名、能力域都使用该 slug。
3. 有目录的工作面，目录名逐字等于正名；有修改日志的工作面，`logModule` 逐字等于正名。
4. 没有目录或日志的概念明确记「不设」，不得为了形式一致发明目录。
5. 端点路径、既有 MCP 工具名不属于这三层，保持不动；`NAMING_TABLE.contract/mcpPrefix` 只用于核对。
6. 内核件无前端显示名，可以按能力域命名，但不得与工作台正名撞车或让用户误认成第二个板块。
7. `推演`继续作为「扮演」页内的引擎模式/动作名；它不是新的工作台正名，也不恢复 `推演/` 目录。

### 2.2 工作台与宿主面逐行表

以下清单覆盖页签栏、正文/剧本右栏、设置页、库切换面板、顶栏路由与 Agent 栏；不是只列可停用工作台。2026-11-25 已与 21 份 manifest（12 workbench＋7 kernel＋2 宿主组合面）及宿主页逐行核对。

| 正名（显示名＝插件名） | 正式 slug（正名 slug） | 库内目录名 | 日志模块名 | 前端位置 | 现状不一致／归一动作 |
|---|---|---|---|---|---|
| 正文 | `chapters` | `正文` | `正文` | 页签＋右栏 | 已一致；写引擎已拆为 `prose` 内核件（OS-163），本工作台只留页面与独占端点 |
| 世界书 | `worldbook` | `世界书` | `世界书` | 页签＋「＋」面板 | OS-190 已把 `namingEntry('reference')` 旧 id 调用改为 `worldbook`；页面 id＝slug `worldbook`，图谱节点类型同步为 `worldbook` |
| 剧本 | `script` | `剧本` | `剧本` | 页签 | 已一致；与正文共用 chapters 契约不等于共用插件内部实现 |
| 故事源 | `storysource` | `故事源` | `故事源` | 页签 | OS-190 页面 id＝slug `storysource`（原 `storySource`）；不并入导入导出 |
| 扮演 | `roleplay` | `扮演` | `扮演` | 页签 | OS-190 页面 id＝slug `roleplay`（原 `deduce`）；`deduce` 仍是内核件，不占第二个用户板块 |
| 习惯 | `habits` | `习惯`（现为习惯表文件所在业务名） | `习惯` | 页签 | 已一致；lint 纯引擎归 `text`，本工作台只拥有规则编辑、写前钩子与提示词钩子 |
| 产物 | `artifacts` | 不设独立目录 | 不设独立日志模块 | 页签 | 页面标题与空态已统一为「产物」（OS-190a） |
| 日志 | `log` | `日志` | 不设（自身只读） | 页签 | OS-190 已立 `class:workbench` manifest（slot tab、page `log`、`requires: prose.write`、零独占端点）；停用仅收起页签，日志数据保留 |
| 分析 | `analysis` | 不设 | 不设 | 正文/剧本右栏 | 纯引擎已归 `text`（OS-193），本工作台只留卡片/图表/定位，零独占端点 |
| 知识库 | `knowledge` | 不设 | 不设 | 设置页模块卡 | OS-190 已改 slug `knowledge`（原 `kb`）；外部 `/api/kb/*`、MCP 名、错误码不动 |
| 生图与识图 | `imagegen` | 不设独立目录；图片仍落条目 assets | 不设 | 设置页模块卡＋世界书生成按钮 | OS-190 已改 slug `imagegen`（原 `comfyui`），`vision` 概念并入 `imagegen`；执行器归 `media`，工作流归 suite |
| 导入导出 | `exchange` | `导入导出` | `导入导出` | 宿主动作（`host-actions`） | OS-172 已正名；保持独立工作台，不吸收故事源 |
| Agent 栏 | `agent` | 不设 | 不设 | 左侧栏 | OS-190 已把显示名与头像字母改为「Agent 栏」/`A`；门禁钉死 `.agent-name` 文本＝agentbar manifest `name` |
| 设置 | `settings` | 不设 | 不设 | 页签／路由 | 宿主面，不登记成可停用工作台 |
| 库管理 | `libraries` | 不设（库根本身是数据） | 不设 | 顶栏／路由 | 宿主面（`library` 组合面），不登记成可停用工作台；建库骨架归 storage 能力 |

**关于目录的边界**：上表「目录名」只表示工作面的业务正名，不要求每个工具面新建一个空目录。现有 `habits.json`、`产物` 的跨目录盘点、`知识库` 的索引等都保持既有固定落盘位置，直到对应工单明确迁移。

### 2.3 七内核件：逐件归类与顺序

顺序表示依赖方向与实施顺序，不表示启动时按目录名硬编码加载。

| 顺序 | 内核件 | 实际能力（manifest） | 硬依赖 | 为什么属于内核件／为什么排这里 | 当前代码证据 |
|---|---|---|---|---|---|
| 1 | `storage` | `storage.roots@1`、`library.list@1`、`storage.scaffold@1`、`storage.inventory@1` | `base.write`、`base.naming` | 所有库、本机院子、货架源、建库骨架与产物盘点的上游；不先解决 root 与源，装载器无法找本机插件，也不能授权库 | `src/modules/storage/{projectDoc,libraryManifest,libraryInventory}.mjs`；`src/protocol/courtyard.mjs` 只作路径纯函数 |
| 2 | `fact` | `fact.store@3`、`fact.pack@1`、`fact.enrich@1`、`fact.engine@1`、`fact.books@1`、`fact.write@1`、`fact.domain@1` | `base.write`、`base.naming` | 事实链是多个工作台共享的数据契约，无 UI；位于 storage 之上、文本/推演/Agent 之下；engine/books/write/domain 是 OS-153～156 拆出的消费面 | `src/modules/fact/index.mjs`、`src/modules/fact/{fact,enrich}/`、`src/protocol/capabilityImplementations.mjs` |
| 3 | `prose` | `prose.write@1` | `base.write`、`base.naming`、`fact.store`、`fact.pack` | 正文/剧本/待确认卡/扮演转正共用读取、写语义、备份和留痕；页面不是写协议本身 | `src/modules/prose/{chapters,chapterWrite,factGuard}.mjs` |
| 4 | `text` | `text.analyze@1` | `base.naming` | 纯函数文本分析同时服务浏览器、MCP、扮演去 AI 味闸和习惯 lint；挂在「分析」工作台会造成内核反向依赖 UI | `src/modules/text/{index,analysis,lint}.mjs`；`public/analysis.mjs` 只是前端消费，原 `src/protocol/text.mjs` 转供叶已删 |
| 5 | `deduce` | `deduce.engine@1` | `base.naming`、`fact.store`、`fact.pack`、`agent.runtime` | 确定性回合执行器无 UI；规则由套件参数化，扮演只负责舞台与交互 | `src/modules/deduce/{index,deduceCapability,deduceEngine,deduceSession}.mjs`、`src/modules/deduce/engine/`、`suites/deduce-rules/` |
| 6 | `agent-runtime` | `agent.runtime@1` | `base.write`、`base.contract` | Agent 存储、DSH/CLI/endpoint 上游、LLM port 是跨工作台服务；不拥有 Agent 栏界面 | `src/modules/agent-runtime/{index,config,credentials,dsh-cli,cli-bridge}.mjs` |
| 7 | `media` | `media.generate@1`、`media.describe@1` | `base.contract` | 生图不是 LLM 对话运行时；识图虽可经 DSH 执行，产品能力仍是媒体输入/输出。单独成件才能让工作流套件替换参数而不换执行器 | `src/modules/media/{index,generate,describe,probe,comfyEngine}.mjs`；工作流 JSON 是 `media-workflow` 套件数据，原 `src/protocol/media.mjs` 转供叶已删 |

**text 结论（建议）**：新增。分析页面可以停用，但 MCP 分析与扮演质量闸不能因此消失；把纯引擎留在工作台会造成 R3 的依赖倒挂。

**media 结论（建议）**：新增。`media.generate` 拥有 OpenAI 兼容生图与 ComfyUI 适配；`media.describe` 拥有识图 port，当前实现可调用 `agent.runtime` 的 DSH 通道。能力边界按产品职责划分，不按当前进程内 import 划分。

### 2.4 工作台三档：逐件归类与顺序

「创作面／工具面」是工作台的两个产品档；「宿主面」是底座自带的组成面，**不是第三个插件档**。

| 档 | 顺序 | 正名 | 归类理由 | 硬依赖（manifest `requires`） | 放置位（`slots[]`，OS-198） |
|---|---|---|---|---|---|
| 创作面 | 1 | 正文 | 直接创作主稿 | `prose.write`、`fact.store` | `tab` order 20 |
| 创作面 | 2 | 世界书 | 创作设定条目与关系 | `fact.store`、`media.generate`、`agent.runtime` | `tab` order 30 |
| 创作面 | 3 | 剧本 | 剧本稿件创作 | `prose.write`、`fact.store` | `tab` order 40 |
| 创作面 | 4 | 故事源 | 事实链的阅读、溯源与富化 | `fact.store`、`fact.enrich` | `tab` order 60 |
| 创作面 | 5 | 扮演 | 多角色交互与回合转正 | `deduce.engine`、`fact.store`、`prose.write`、`text.analyze` | `tab` order 80 |
| 工具面 | 1 | 习惯 | 写作规则编辑与 lint 入口 | `text.analyze` | `tab` order 70 |
| 工具面 | 2 | 产物 | 跨目录产物盘点与恢复 | `storage.roots`、`storage.inventory` | `tab` order 10 |
| 工具面 | 3 | 日志 | 跨模块 diff/log 自检索 | `prose.write` | `tab` order 50 |
| 工具面 | 4 | 分析 | 指标、图表、批注与定位 | `text.analyze` | `right` order 10 |
| 工具面 | 5 | 知识库 | 知识集合与检索入口 | `agent.runtime` | `settings` order 20 |
| 工具面 | 6 | 生图与识图 | 媒体能力配置、生成与白描入口 | `deduce.engine`、`media.generate`、`media.describe` | `settings` order 10 |
| 工具面 | 7 | 导入导出 | 数据进出与格式适配 | `fact.store`、`fact.domain`、`storage.roots`、`prose.write` | `host-actions` order 10 |
| 宿主面 | 1 | Agent 栏 | 底座自带对话面，消费 runtime/prose/text，不是可停用创作插件 | `agent.runtime`、`storage.roots`、`fact.store` | 无 slot，恒启用 |
| 宿主面 | 2 | 设置 | 底座本体设置与插件管理 | 仅 `base.*` | 宿主页，固定排在模块页签之后 |
| 宿主面 | 3 | 库管理 | 底座自带库清单/建库/导入面 | `storage.roots`、`library.list`、`storage.scaffold`、`fact.store` | 无 slot，恒启用 |

**两档是否成立**：成立。创作面直接产出或组织作品内容；工具面提供跨作品流程、质量、素材与数据服务。两档只用于产品说明和默认 slot 编排，不制造新的 class。

**宿主面处理**：Agent 栏、设置、库管理作为底座组合面登记，不套 `class:workbench`。`agentbar`/`library` manifest 恒启用、拒绝停用键；设置与库管理是宿主页，不登记成可停用工作台。OS-196 后 `class` 只允许 kernel/workbench/suite，宿主组合面以「无 class＋恒启用」表达。

### 2.5 六种创作套件供给：逐件归类与顺序

| 顺序 | 套件供给 | `supplies` 值 | 为什么是套件／执行边界 | 当前落点 |
|---|---|---|---|---|
| 1 | skill 包 | `skill` | 提示词与手艺配方是数据；Agent 执行，套件不加载代码 | `skills/`（31 包）、`src/services/skills.mjs` |
| 2 | 推演规则包 | `deduce-rule` | 2d6、局面卡、候选模板是可替换规则数据；确定性仍在 `deduce.engine` | `suites/deduce-rules/{manifest,rules}.json` |
| 3 | 生图工作流包 | `media-workflow` | ComfyUI 工作流 JSON、节点映射与参数预设是数据；执行在 `media` | 工作流 JSON 样例 `samples/qwen-image-2.1-t2i.json`（仓根 `workflows/` 已随 OS-159 归位并删目录）；执行器 `src/modules/media/comfyEngine.mjs`；`media-workflow` 是协议登记的供给类型，内置套件尚未捆绑该供给 |
| 4 | 文风包／体裁包 | `resource`＋`resourceKind=style|genre` | 色板、体裁、篇幅与页签裁剪是声明式资源；storage 只执行模板 | `styles/`、`genres/`、`src/services/{stylePacks,genres}.mjs` |
| 5 | 运行时套件 | `runtime` | CLI kit 的 endpoint/probe/command 是**受控扩展描述**，不是可导入插件代码；适配器在 `agent-runtime` | `runtimes/`、`src/services/runtimes.mjs` |
| 6 | 业务套装 | `bundle` | 只捆绑上述供给与依赖闭包，不另造执行器 | `suites/`（`writing`、`screenwriting`、`deduce-rules`）、`src/services/suites.mjs` |

**投影来源（OS-192 单一入口）**：五类货架由 `src/protocol/shelfManifests.mjs` 的 `loadShelfCapabilityManifests()` 投影成 `openstory-module@2` 套件，与内置 workspace/kernel 共用能力图、启停与设置值（`.openstory/plugins/suite-state.json`）。`class:suite` 禁带可执行入口（`.mjs/.cjs/.js/.wasm/.sh/.ps1/.bat/.cmd` 与含 `<script>` 的 HTML 一律拒收）；legacy `openstory-suite@1/@2` 页面模式、`/suite-assets/` 路由与漫剧占位套件已退役。

**运行时套件归属**：保留在 suite 的 `runtime` 供给类型，作为 `agent.runtime` 的受控本机扩展；不单列第四个 class，也不把 kit 目录当可导入代码包。`src/services/runtimes.mjs` 的 `command.cmd`／`spawn`／sidecar 生命周期是宿主已实现的命令协议，套件只描述参数。

**安全前提**：suite 目录不得包含宿主可执行代码；runtime manifest 只能描述宿主已实现的命令协议。第三方 runtime 命令执行另设作者信任、命令白名单与可执行文件指纹，不随 OS-196 的本机模块开放一并放开。

### 2.6 工作台消费与贡献（OS-195a）

工作台要拿别人的东西，只准走四条路径：

1. 内核件能力 → `context.resolve(id, range)` 句柄；
2. 宿主组合面（`agentbar`／`library`）→ 只有宿主可直接 import，其他模块走端点分派；
3. 给宿主（含 Agent 栏）的东西 → `activate()` 贡献**钩子**，宿主按库快照取，模块停用＝钩子消失；
4. 用别的工作台的东西 → 底座端点分派（`handlerFor(endpointId, root)`），不 import 对方内部。

钩子只在 `src/protocol/moduleActivation.mjs` 登记四个名字：`beforeWrite`／`promptContext`／`referenceIndex`／`startup`；当前贡献者：习惯（`beforeWrite.habitsLint`、`promptContext.habits`）、知识库（`promptContext.knowledge`、`startup.knowledge`）、世界书（`promptContext.worldbook`、`referenceIndex.worldbook`）。宿主唯一取用口是 `src/host/moduleHooks.mjs` → `handlerTable.hooksFor()`。

边界门禁：R-a 内核实现只有 `src/protocol/capabilityImplementations.mjs` 可静态 import；R-b 工作台内部只许本模块 handler 与前端视图触及；R-c `src/protocol/` 文件清单与 `src/protocol/README.md` 一致、零转供叶；R-d `src/services/` 只留底座服务与货架装载。门禁 S2.1／S2.4'／S2.7／S2.11 直接数静态 import，无白名单。

### 2.7 本机模块与迁移器（OS-196／196a／197）

- **信任模型**：登记一个模块根＝信任该根下所有模块代码；模块与 daemon 同进程同权限。**边界门不是沙箱**，只挡 import/require 越出包目录与误用，挡不住同进程代码直接摸 `process`／`node:fs`。预览必须原样显示风险说明。
- **G1 信任门**：`src/host/moduleRoots.mjs` 读写机器级信任表；未登记的根不扫描、不装载、不报告。
- **G2 身份门**：`manifestSha256`＋入口与包内传递依赖（含 JSON）的 `contentSha256` 进快照 id 与激活缓存键；与登记摘要不符标「内容已变」。
- **G3 边界门**：`src/host/moduleBoundaryHooks.mjs` 用 `module.registerHooks({ resolve })` 运行期强制，包内 import/require 只许 `node:` 内置或同包 realpath；静态扫描只作预览提示。
- **G4 切换门**：`src/host/moduleRuntime.mjs` 先做端点归属＋三检查 → 淘汰违规模块（不跑 `activate`）→ 只激活合格者 → 校验贡献 → 重做检查 → 一次同步赋值；在途请求持旧句柄到底。
- **端点归属**：本机模块只能注册自己的新端点，或按 id 覆盖某个内置模块时接管其端点；宿主自有端点与别的模块端点谁都不能认领。自带契约路径必须在 `/api/modules/<id>/…`，登记后与内置端点共用 `endpointFor`／`validateRequest`／错误信封。
- **页面**：第三方工作台用 `pages[].kind:'iframe'`＋`entry` 声明页面，daemon 只对已登记且装载成功的本机模块提供 `/module-page/<id>/<entry>`；slot 投影 `view:'iframe'`。
- **迁移器（OS-197）**：内核能力升级落盘格式时必须带迁移器与失败安全阀；宿主在业务 handler 前按库执行，失败回滚并保留原文件；workbench/suite 不得提供迁移器。

---

## 三、底座五件：逐条质询

### 3.1 进程与网络

**内容**：daemon 生命周期、127.0.0.1 绑定、单实例锁、stamp/generation、来源与请求体闸、health、静态托管骨架、SSE 出口。现状见 `src/host/daemon.mjs:startDaemon/acquireDaemonLock/stampDaemonLock` 与 `src/host/http.mjs`。

**为什么不能插件化**：插件装载器本身运行在进程里；若进程、锁、监听和 health 都由待装载插件提供，裁判没有立足点。health 还必须是零库、零插件时仍可用的底座事实。

**反例质询**：如果允许「进程插件」替换 daemon 生命周期，它可以在装载前改端口、绕过 loopback、不写 stamp，或让旧 generation 继续服务；届时插件治理再严也保护不了进程边界。

**结论**：保留在底座。单实例锁当前是尽力而为，不承诺同毫秒 `O_EXCL` 互斥；这是现状限制，不因本 ADR 自动升级。

### 3.2 装载协议

**内容**：manifest 校验、源发现、能力图三检查、覆盖注册表、启停推导、路由快照、启动报告。B 批前只有 @1 校验与 warning 跳过；当前实现见 `src/protocol/modules.mjs:validateModuleManifest/loadModuleManifests`，stage C 已在内置运行时启用。

**为什么不能插件化**：装载协议负责判定谁有资格被装载。若装载器也是插件，就必须先有另一个装载器，形成无穷回归；且冲突裁决不能由冲突双方实现。

**反例质询**：若某插件可替换校验器并把自己的 `requires` 标成已满足，它就能在没有 storage/fact 时装载；能力图检查变成可选装饰。

**结论**：保留在底座。装载协议可以调用内核件提供的数据，但不能反向依赖内核件才能完成「发现内置内核件」这一步。

### 3.3 契约壳

**内容**：`endpointFor`、请求/响应形状、统一错误信封、handler 分派框架、MCP 转发框架。现状见 `src/api/contracts.mjs:errorEnvelope`、`src/api/registry.mjs`、`src/host/http.mjs:sendError`。

**为什么不能插件化**：所有插件必须说同一种请求/错误语言；错误码与 HTTP 映射若由业务插件自定，前端与 MCP 无法稳定判断 404、409、503。契约壳还承载 health 等免 root 端点的最早分派。

**反例质询**：若「错误插件」坏了，装载错误本身应该由谁返回？若各插件自带信封，同一个能力缺失会出现多种 JSON，降级也就无法机器识别。

**结论**：保留在底座。具体业务 handler 归插件；契约壳只拥有形状、分派与错误语言，不拥有业务实现。

### 3.4 物理写管道

**内容**：文本/二进制原子写、临时文件、fsync＋rename＋目录 fsync、写前备份钩子、迁移 journal 的物理提交。现状见 `src/protocol/hostWrite.mjs:atomicWriteFile` 与 `src/kernel/atomicWrite.mjs/fsDurability.mjs`。

**为什么不能插件化**：格式可以换，但「不能半写」「必须可追溯」是所有插件的共同安全前提。若每个插件自带原子写实现，备份、日志与迁移失败语义无法统一保证。

**反例质询**：若允许写管道插件替换实现，它可以在 rename 前返回成功、跳过目录 fsync，或直接写库外路径；fact/prose 的金样再绿也保护不了真实事故中的半迁状态。

**结论**：保留在底座。fact/prose 拥有格式与业务写协议，但最终物理提交必须调用底座写管道；插件不得直写业务目录。

### 3.5 词表

**内容**：`NAMING_TABLE`、slots 注册（`openstory-slots@1`）、能力 id 语法与注册表、错误码注册。显示名词表仍在 `public/views/registry.mjs`，由 `src/protocol/naming.mjs` 转供（终局见 §5.4）；能力实现已汇集到 `src/protocol/capabilityImplementations.mjs`，经 `src/host/capabilityBindings.mjs` 与工作台 `activate(context)` 按库快照解析。OS-198 起页签、右栏、侧栏、宿主动作与设置卡的放置位只来自 manifest `slots[]`，`/api/plugins.slots` 是前端唯一投影来源。

**为什么不能插件化**：正名、slug、目录、日志模块和 slot 是跨插件共同语言；若插件可自行改词表，就会出现同一概念两套正名，日志按不同模块拆散，路由与界面对不上。

**反例质询**：若「命名插件」在运行时把 `世界书` 改成 `参考`，已写入的日志仍按「世界书」检索，旧库目录也不动；界面一致但数据身份被切成两半。

**结论**：保留在底座。能力 id 不由底座写死全部清单；底座固定语法、`base.*` 保留域与注册时机，其余 id 由供给者声明、启动时登记。

---

## 四、自举、装载顺序与保底供给

### 4.1 零插件状态到底能做什么

必须区分「零第三方插件」与「字面零插件」：

- **零第三方插件**：随包内置七内核件、工作台与默认套件仍可装载；这是正常安装的最小产品态。
- **字面零插件**：所有 kernel/workbench/suite 都缺席时，底座仍能绑定 loopback、取锁、写 stamp/generation、提供 health、返回统一错误信封、提供静态设置/错误页与命名投影、扫描随包内置 manifest 源；物理写 API 存在，但没有业务 handler 使用它。
- 字面零插件时，库列表、建库、业务页签与 MCP 数据操作不可用；不得回退到真实清单第一条库或绕过 storage 授权猜 root。

### 4.2 分阶段装载序

1. **B0 进程底座**：`src/host/daemon.mjs:startDaemon` 初始化进程/网络，CLI 启动序列先过 `acquireDaemonLock/stampDaemonLock`；错误信封由 `src/host/http.mjs:sendError` 统一；此时不读库清单。
2. **B1 内置源发现**：`src/protocol/modules.mjs:loadModuleManifests(MODULES_DIR)` 在模块 import 时扫描随包 `src/modules/`，逐份过 `validateModuleManifest`（`openstory-module@2`）；不扫描本机院子。
3. **B2 storage 优先**：`storage` 能力实现由 `src/protocol/capabilityImplementations.mjs` 登记，经 `src/host/capabilityBindings.mjs` 按库解析；本机院子、货架源与库清单由 `storage.roots` 提供，缺席时只跳过本机源，不阻止 daemon 启动。
4. **B3 内核图检查**：`src/host/moduleRuntime.mjs:buildLayer` 对候选做端点归属＋底座路由不动＋内置路由不丢三项检查；第一份内置快照由 `src/protocol/capabilityGraph.mjs:buildCapabilitySnapshot` 生成。
5. **B4 工作台登记**：manifest 的 `pages[]/slots[]/endpoints[]/requires[]` 在 manifest 层校验；不执行页面代码。slot 编排由 `src/protocol/slots.mjs:slotPlacements` 生成，OS-198 起经 `/api/plugins.slots` 投影给前端。
6. **B5 套件装载**：`src/protocol/shelfManifests.mjs:loadShelfCapabilityManifests` 把五类货架投影成 module@2 套件并入 `ALL_CAPABILITY_MANIFESTS`；本机源只有通过机器级信任表（`src/host/moduleRoots.mjs`）才进入候选。
7. **B6 全图复检与原子切换**：`buildLayer` 先激活合格本机模块，再重做归属与三检查；通过后 `ensureRuntime/rebuildRuntime` 一次同步赋值 `layers` Map，未通过项进入 `report.rejections` 并降级。
8. **B7 请求服务**：`src/host/handlerTable.mjs` 与 `moduleRuntime` 的 `snapshotFor/endpointOwnerFor` 读当前层；`rebuildRuntime` 换层后新请求用新层，在途请求已持旧 handler/能力句柄，持旧到底。

### 4.3 底座 requires 与保底者

| 能力 | 是否影响进程启动 | 保底供给 | 缺失结果 |
|---|---|---|---|
| `base.process`、`base.loader`、`base.contract`、`base.write`、`base.naming` | 是；底座自身实现 | 底座（`src/host/baseCapabilities.mjs` 五个只读句柄） | 不存在「缺底座还能启动」语义；实现损坏是发布阻断 |
| `storage.roots@1`、`library.list@1`、`storage.scaffold@1`、`storage.inventory@1` | 否 | 内置 `storage` | health 正常；不扫本机源、不授权库，启动报告记断链 |
| `prose.write@1` / `capabilityImplementations` 中的 changelog 通道 | 否 | 内置 `prose` | 日志宿主面降级；其他写作能力按自身依赖判定 |
| `fact.store@3` 等 fact 能力 | 否 | 内置 `fact` | 依赖 fact 的工作台不装载或降级，daemon 仍起 |

**口径**：底座最小 requires 只包含完整宿主面所必需的各项能力；它们不是 `core:true` 的翻版，而是能力图里的硬边。缺少它们不拖死 daemon，但对应宿主面明确不可用。`prose.changelog` 已不是独立能力 id，变更日志经 `prose.write` 与 `src/protocol/changelog.mjs` 的写通道提供。

### 4.4 能力路由形态

**建议一步到位使用薄代理**：插件只拿 `resolve(capabilityId, range)` 返回的稳定句柄；句柄绑定一个不可变快照。禁止插件长期缓存裸函数引用后再假定路由永不变化。重建路由必须先完整校验，再切换指针；未校验热替换不允许。

---

## 五、四个开放问题的最终结论

### 5.1 storage × genres

**现状**：`src/modules/storage/projectDoc.mjs:PROJECT_KINDS/createProject` 拥有骨架目录、载体与建库流程，`libraryInventory.mjs` 提供产物盘点；`src/services/genres.mjs:normalizeGenre/allowedDirs/briefPromptSection` 仍拥有 `deliverables/excludedPages/agentPolicy`。体裁自 OS-192 起已是 `class:suite` 的 `resource` 供给（`resourceKind:genre`），由 `src/protocol/shelfManifests.mjs:projectGenre` 投影进能力图；尚未做的只有「把体裁模板闭包（交付物／`excludedPages`／篇幅／Agent policy）完整写进能力图」这一步，闭包字段仍由 `src/services/genres.mjs` 的 `allowedDirs/briefPromptSection` 与 `src/services/systemPrompt.mjs` 在目录约束与提示词处消费。

**结论**：

- `storage` 拥有 root、清单、目录安全与「按已验证模板建骨架」的执行器。
- 体裁包拥有骨架模板、交付物、`excludedPages`、篇幅与 Agent policy。
- storage 不解释体裁规则；genre 不直接写盘，只能声明模板。
- 内置最小模板作为保底资源随包；缺体裁资源时 generic 建库仍可用，体裁专属页签不出现。`genres/*.json` 自 OS-192 起已由 `src/protocol/shelfManifests.mjs` 投影成独立 `class:suite` 的 `resource`（`resourceKind:genre`），与模块共用能力图与 suite-state；`src/services/genres.mjs` 继续做原始资源的装载与规范化，未做的是模板闭包写进能力图。

### 5.2 jobCenter／events

**现状**：`src/host/jobCenter.mjs` 是单一 Map，重启即清；`src/protocol/agentEvents.mjs` 只提供进程内事件词表；`src/host/processServices.mjs` 把两者作为 `base.process` 的只读服务映射暴露。

**结论**：归底座。它们是进程服务，不是创作能力；长任务的业务执行器可以由插件提供，但登记、查询、取消、订阅与 SSE 帧投影由底座统一。若未来任务需要跨重启恢复，另立 ADR，不把「未确认内容必须落盘」偷换成「所有瞬时进度必须持久化」。

### 5.3 套件声明式逻辑边界

**现状**：skills 是 Markdown 配方，styles/genres 是 JSON，runtimes 含命令描述；OS-192 已把五类货架投影成 `openstory-module@2 class:suite`，套件目录禁带可执行入口；legacy `openstory-suite@1/@2` 页面模式与 `/suite-assets/` 路由已退役。

**结论**：

- `module@2 class:suite` 只允许有限 JSON 描述的参数、条件分支、枚举与资源引用；允许数据驱动 DSL，禁止图灵完备脚本、宿主 import 与动态 `eval`。
- 禁带 `.mjs/.js/.cjs`、内联脚本 HTML、WASM、shell 片段与迁移器；`src/services/suites.mjs:findExecutableInSuite()` 扫描拒收。
- runtime kit 的命令描述是受控数据，不是 suite 代码；命令执行能力仅在 `agent-runtime` 适配器内。

### 5.4 naming 双端方案

**现状**：`src/protocol/naming.mjs` 直接 re-export `public/views/registry.mjs`；`NAMING_TABLE` 仍是全仓唯一字面量（`test/naming.test.mjs` 门禁钉死）。

**结论（OS-198 后定稿）**：暂不迁移。运行时投影会为首屏页签引入网络依赖，生成静态投影则要放宽注册表零 import 门禁并引入第二份生成物；两项都不优于「单一数据＋双端消费」。因此保留现方案，并由 `base.naming` 暴露只读投影、`SLOT_REGISTRY/isRegisteredSlot/slotEntry` 暴露 slot 词表。**页签/右栏/设置卡等放置位不再由词表或前端名单决定**——os-198 起只来自 manifest `slots[]` 与 `/api/plugins.slots`；`TAB_REGISTRY` 只存视图行为。若后续需要插件新增命名，再按「数据归底座、前端消费投影」重评。

---

## 六、R1–R14 逐项处置

| # | 处置 | 落点与理由 |
|---|---|---|
| R1 | **采纳** | OS-172／OS-189：旧库一次性升级、备份、回滚与 Pinax 业务退役；反转留痕见 §七。 |
| R2 | **采纳并改写** | OS-173 立、OS-196／196a 落地：B0–B7 两阶段图检查；storage 先解决源发现，字面零插件仍可启动。 |
| R3 | **采纳** | OS-193：`text` 内核件成立；`public/analysis.mjs` 的纯函数与「分析」工作台拆开，MCP/扮演/习惯不再依赖 UI 模块。 |
| R4 | **采纳并补错误码** | OS-193／195：hard requires 缺失使消费者不装载或降级，报 `PLUGIN_DEGRADED`；`MODULE_DISABLED` 表示工作台被作者停用。 |
| R5 | **采纳** | OS-196 `moduleRuntime.buildLayer`：daemon 永远先启动；缺能力插件不装载，`GET /api/plugins` 启动报告列断链，health 仍只报进程事实。 |
| R6 | **采纳并收窄** | OS-192＋OS-197：suite 只有资源覆盖，禁止迁移器；capability 覆盖与其迁移器只能来自 kernel；workbench 覆盖不得改落盘格式。 |
| R7 | **采纳** | OS-195：底座只保留 `base.*` 与 id 语法，其他能力 id 启动时登记；`src/host/baseCapabilities.mjs` 五个句柄。 |
| R8 | **采纳** | OS-196／196a：候选快照→三检查→原子切换；在途请求持旧快照，禁止未校验替换（`test/localModules.test.mjs` G4-6）。 |
| R9 | **采纳** | OS-198：`pages[]` 只留 id/label/kind/entry，嵌入点统一由 `slots[]` 的 `{slot,page,order}` 声明；`slotPlacements/slotProjection` 单一入口。 |
| R10 | **采纳** | OS-155：默认推演规则包绑定确定性金样；同种子＋同事实包＋同规则＝同拍，换规则包必须提供新金样。 |
| R11 | **采纳** | OS-193：`media` 内核件成立；生图工作流套件只供 JSON，执行器不归 `agent.runtime`。 |
| R12 | **采纳** | OS-199：文档只用当前实测，数字由 `ARCHITECTURE.md` 生成段与 `docs/number-anchors.json` 给出；历史段数字不当作现状。 |
| R13 | **采纳，OS-169 收口** | 测试使用临时 `LOCALAPPDATA` 与夹具库；不靠本机 CLI/模型/真目录。 |
| R14 | **采纳，OS-172／189 收口** | 去 Pinax 影响面由 OS-172 的八类现状盘点与 OS-189 的残留退役共同承担。 |

---

## 七、R1 反转留痕

| 旧口径 | 新口径 | 理由与后果 |
|---|---|---|
| 旧库不迁移 | 旧库一次性备份、迁移、失败回滚；成功后旧目录 `.retired-*` 留档，运行态不双读 | 作者已把验收标准改为 OpenStory 内部代码质量，并确认 OS-172。作者真库第一次用新版打开时执行；测试仍只用临时夹具 |
| 金样不动＝Pinax 互认唯一锚 | 金样随能力走，作为内部格式与行为契约；保留真实内核出处，但不以 Pinax 桌面端互认为验收 | 互认已拆除；`test/decoupleStep2.test.mjs` 后续转为 `storage/fact` 能力金样，不删既有保护 |
| 用 Pinax 桌面端开新库确认 | 该动作作废；改为作者用新版 OpenStory 打开既有真库，确认升级报告；新库用 OpenStory 自身 e2e 验证 | `docs/LEGACY-ITEMS.md` 已删旧动作；不要求安装 Pinax，也不把作者真库交给自动测试 |

### 7.1 与 Pinax 断干净的落点核对

| 收尾项 | 当前落点 | 状态 |
|---|---|---|
| `project.json` 谱系名 | `openstory-project@4`、`openstory.carrier.*`；wiki `openstory-wiki-derived@2`；临时前缀 `.openstory-tmp-` | OS-172 已实现 |
| `DEMO.md` 口径 | `docs/DEMO.md` 只留《水浒传》 | 已实现（OS-172）；Agent 栏显示名与头像字母 OS-190 已改为「Agent 栏」/`A`，门禁钉死与 agentbar manifest 同名 |
| 三份 Pinax 对标/历史规划 | `docs/plan/{decouple-pinax-core-20261122,kernel-own-design,route-batch2-20261123}.md` 顶部均标「历史文档，现状以 OS-172 为准」 | 已实现 |
| 台账「桌面端开新库确认」 | `docs/LEGACY-ITEMS.md` 已无该动作；真库首次打开看升级报告保留为作者动作 | 已实现 |
| 真实出处 | `docs/kernel-provenance.md`、README 致谢 | 必须保留，不属于品牌关联 |

---

## 八、实施沿革（历史记录，现状以上文为准）

> 本节合并原「B 批实施结果与剩余边界」与「C6 架构门禁与数字锚实施记录」。过程数字与阶段结论只说明当时状态；当前模块数、端点数、测试数与 `app.js` 行数以 `ARCHITECTURE.md` 生成段和 `docs/number-anchors.json` 为准。

1. **B1–B3**：manifest 升 `openstory-module@2`；能力图三检查与候选状态事务落地；模块级 `core`／`MODULE_CORE` 删除。页签级 `core:true` 只表示顶栏可达，不再控制模块启停（OS-176 已验证四个原核心工作台可停用）。
2. **B4**：`deduce` 归内置 kernel；`agentbar`／`library` 归宿主组合面，恒启用且拒绝停用键。`storage`／`agent-runtime` 的代码拆分在 C 批完成。
3. **B5**：`deduce.engine@1` 由 kernel manifest 提供，`roleplay` 声明硬依赖；推演 handler 经按库薄代理解析能力，外部端点与 MCP 名不变。
4. **C 批**：OS-193 把十个内核兼容叶改为能力句柄；OS-194 把 handler 归还插件，`allHandlers()` 直接由模块贡献；OS-195／195a／195b 立四条边界与 R-a～R-d，`src/protocol/` 只留底座契约、`host-api@2` 命名空间退役。OS-190／190a 完成分类与页面 id＝slug；OS-192 完成五类货架统一投影、套件无代码扫描与 legacy 页面模式退役。
5. **C6 门禁**：`tools/arch-stats.mjs` 直接读源码与 manifest 生成本文数字；S2.1 扫静态与动态 import，S2.4' 禁 kernel 反向依赖与 core/vendor 回潮，S2.7 合并覆盖、端点归属、激活贡献校验，S2.5 钉三名一致。数字锚由 `tools/number-anchors.mjs` 回写并校验 `ARCHITECTURE.md`／`README.md` 关键数字。
6. **D 批**：D1 覆盖路由＋回退链、D2 迁移器框架、D3 套件升格 `openstory-module@2`、D4 slot 注册表与动态装载评估落地；D4 当时裁定不开放第三方可执行模块，开门条件 G1–G5 见 ADR 0003。
7. **清账批**：OS-189 退役 Pinax 残留业务；OS-196 开放本机可执行模块（机器级信任表）；OS-196a 返工为运行期解析钩子边界、整图摘要身份、端点归属与候选层切换；OS-197 把迁移器接进宿主写前检查；OS-198 把 slot 投影接到前端并支持第三方 iframe 页；OS-199 收口文档与数字锚。
8. **当时遗留、现已收口**：Agent 栏标题、产物标题、故事源空态、`namingEntry('reference')` 旧 id 均已完成；自定义目录入口只物化词表内目录是既有限制，按 `docs/LEGACY-ITEMS.md` 保留；本机模块不是沙箱，风险说明照实呈现。

---

## 九、裁定与实施状态（D1–D8 已全部落地）

作者已按「不接受妥协」的口径逐项裁定并实施；下列状态是实施事实，不是待批建议；如作者后续调整，以新的明确裁定为准。

| # | 事项 | 状态与证据 |
|---|---|---|
| D1 | 三名一致表与七内核件顺序 | **已实施**：§二已按 21 份 manifest 核对；`test/naming.test.mjs`＋门禁 S2.5 守三名一致；内核顺序 storage→fact→prose→text→deduce→agent-runtime→media 与 manifest `requires` 一致。 |
| D2 | 工作台分创作面/工具面，宿主面归底座 | **已实施**：§2.4 表与 12 工作台＋2 宿主组合面逐行一致；`test/modulePlugins.test.mjs` 校验 class/slots/pages 形状。 |
| D3 | `生图与识图`／`知识库` slug | **已实施（OS-190）**：`imagegen`／`knowledge`；外部 `/api/kb/*`、`/api/vision/describe`、MCP 工具名未改。 |
| D4 | runtime kit 归属 | **已实施（OS-192）**：`runtime` 供给仍属 suite，命令执行在 `agent-runtime`；`src/services/suites.mjs` 禁可执行文件。 |
| D5 | 宿主域旧模块拆法 | **已实施（OS-193/194）**：`deduce→kernel`；`library→storage 能力＋库管理宿主面`；`agentbar→agent.runtime＋Agent 栏宿主面`。 |
| D6 | naming 最终归属 | **已实施（§5.4 定稿，OS-198）**：保留「单一数据＋双端消费」；`base.naming` 只读投影；slot 词表归底座。 |
| D7 | suite 边界与 legacy page 模式 | **已实施（OS-192）**：新 suite 无宿主可执行代码；legacy 页面模式与 `/suite-assets/` 已退役。 |
| D8 | 底座硬依赖与停用语义 | **已实施（OS-193/195/196）**：缺依赖不拖死 daemon，hard consumer 缺失回 `PLUGIN_DEGRADED`，作者停用回 `MODULE_DISABLED`。 |

---

## 十、作者裁定记录

- 2026-11-25：作者明确要求不再等待旧工单逐项批准，按已写细规划继续各批实现。B1–B5 已据此实施；七内核件落盘与统一注册表、C6 门禁和数字锚已推进，后续 C/D 批已按同一口径完成。
- 2026-11-25（D 批收口）：D1 覆盖路由＋回退链、D2 迁移器框架、D3 套件升格 `openstory-module@2`、D4 slot 注册表与动态装载评估均已落地；`base.process` 服务映射补齐。D4 当时裁定不开放第三方可执行模块；该裁定的 G1–G5 已在 OS-196／196a 逐门满足并开放本机模块，见 [ADR 0003](0003-dynamic-loading.md)。
- 2026-11-25（清账批裁定原文）：「对于整个 D 批内的遗留问题项，规划好之后安排 CodeBuddy CLI 协助完成，不接受妥协。待定里面的几个 Pinax 业务必须全部退役。」据此建立清账批 OS-189～OS-199：遗留全部做完，验收以「生产调用方在真实请求路径上生效」为准；Pinax 残留业务（院子克隆、旧清单读、导入识别、旧前缀等）已由 OS-189 退役，真实出处声明按 §七保留。
