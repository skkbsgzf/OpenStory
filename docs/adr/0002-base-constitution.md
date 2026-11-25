# ADR 0002 · 底座宪法与三层半插件边界

**状态：架构方向已裁定；B1–B5、C 批与 D1–D4 已实施，D4 动态装载裁定本批不开放第三方可执行模块（ADR 0003）。**

- 对应工单：[OS-173](../workorders/OS-173-base-constitution.md)
- 规划来源：[第三批规划](../plan/batch3-microkernel-plan.md) §1–§3
- 配套语言：[module-manifest@2 协议](../protocol/module-manifest-2.md)
- 前序裁定：[ADR 0001 · fact 数据源归一](0001-fact-schema-unification.md)（数据源结论继续有效；文中的旧路径与旧 schema 名是历史证据）

> **阅读口径**：§二至§五是架构裁定；§八保留 B 批实施时的历史基线，§八·补记录 C6 当前实现与仍待主 agent 处理的源码边界。历史段中的 14 模块、1 kernel、11,838 行等数字不代表当前状态；当前数字由 `ARCHITECTURE.md` 生成段与 `docs/number-anchors.json` 给出。作者已明确要求按既有细规划继续各批实现，不再等待旧工单逐项批准；C 批与 D1–D4 已按此实施，第三方可执行模块装载按 ADR 0003 明确裁定不开放，不属于未完成项。

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

以下清单覆盖页签栏、正文/剧本右栏、设置页、库切换面板、顶栏路由与 Agent 栏；不是只列可停用工作台。

| 正名（显示名＝插件名） | 建议 slug | 库内目录名 | 日志模块名 | 前端位置 | 现状不一致／归一动作 |
|---|---|---|---|---|---|
| 正文 | `chapters` | `正文` | `正文` | 页签＋右栏 | 名称已一致；现模块混有写引擎与页面，B/C 批拆为 `prose` 内核件＋本工作台 |
| 世界书 | `worldbook` | `世界书` | `世界书` | 页签＋「＋」面板 | OS-190 已把 `namingEntry('reference')` 旧 id 调用改为 `worldbook`；页面 id＝slug `worldbook`，图谱节点类型同步为 `worldbook` |
| 剧本 | `script` | `剧本` | `剧本` | 页签 | 已一致；与正文共用 chapters 契约不等于共用插件内部实现 |
| 故事源 | `storysource` | `故事源` | `故事源` | 页签 | OS-190 页面 id＝slug `storysource`（原 `storySource`）；不并入导入导出 |
| 扮演 | `roleplay` | `扮演` | `扮演` | 页签 | OS-190 页面 id＝slug `roleplay`（原 `deduce`）；`deduce` 仍是内核件，不占第二个用户板块 |
| 习惯 | `habits` | `习惯`（现为习惯表文件所在业务名） | `习惯` | 页签 | 已一致；lint 纯引擎归 `text`，本工作台只拥有规则编辑与消费入口 |
| 产物 | `artifacts` | 不设独立目录 | 不设独立日志模块 | 页签 | 页面标题仍写「产物中心」，后续统一为「产物」；空态「去正文/大纲」一并改现行名 |
| 日志 | `log` | `日志` | 不设（自身只读） | 页签 | OS-190 已立 `class:workbench` manifest（slot tab、page `log:日志`、`requires: prose.write`、零独占端点）；停用仅收起页签，日志数据保留 |
| 分析 | `analysis` | 不设 | 不设 | 正文/剧本右栏 | 现无独占 daemon 端点但被 MCP、扮演、习惯消费；纯引擎必须拆到 `text`，本工作台只留卡片/图表/定位 |
| 知识库 | `knowledge` | 不设 | 不设 | 设置页模块卡 | OS-190 已改 slug `knowledge`（原 `kb`）；外部 `/api/kb/*`、MCP 名、错误码不动 |
| 生图与识图 | `imagegen` | 不设独立目录；图片仍落条目 assets | 不设 | 设置页模块卡＋世界书生成按钮 | OS-190 已改 slug `imagegen`（原 `comfyui`），`vision` 概念并入 `imagegen`（识图是其功能之一）；执行器归 `media`，工作流归 suite |
| 导入导出 | `exchange` | `导入导出` | `导入导出` | 库切换面板 | OS-172 已正名；保持独立工作台，不吸收故事源 |
| Agent 栏 | `agent` | 不设 | 不设 | 左侧栏 | OS-190 已把 `public/index.html` 头部显示名与头像字母改为「Agent 栏」/`A`，门禁钉死 `.agent-name` 文本＝agentbar manifest `name` |
| 设置 | `settings` | 不设 | 不设 | 页签／路由 | 宿主面，不登记成可停用工作台 |
| 库管理 | `libraries` | 不设（库根本身是数据） | 不设 | 顶栏／路由 | 宿主面，不登记成可停用工作台；建库骨架归 storage 能力 |

**关于目录的边界**：上表「目录名」只表示工作面的业务正名，不要求每个工具面新建一个空目录。现有 `habits.json`、`产物` 的跨目录盘点、`知识库` 的索引等都保持既有固定落盘位置，直到对应工单明确迁移。

### 2.3 七内核件：逐件归类与顺序

顺序表示依赖方向与实施顺序，不表示启动时按目录名硬编码加载。

| 顺序 | 内核件 | 建议能力 | 为什么属于内核件／为什么排这里 | 当前代码证据 |
|---|---|---|---|---|
| 1 | `storage` | `storage.roots@1`、`library.list@1`、`storage.scaffold@1` | 所有库、本机院子、货架源、建库骨架的上游；不先解决 root 与源，装载器无法找本机插件，也不能授权库 | `src/modules/storage/{courtyard,libraryManifest,projectDoc}.mjs`；`src/protocol/courtyard.mjs` 仅转供 |
| 2 | `fact` | `fact.store@3`、`fact.pack@1`、`fact.enrich@1` | 事实链是多个工作台共享的数据契约，无 UI；位于 storage 之上、文本/推演/Agent 之下 | `src/modules/fact/index.mjs` 与 `src/modules/fact/{fact,enrich}/`；`src/protocol/index.mjs` 保持 Host API `fact` 五键形状 |
| 3 | `prose` | `prose.write@1` | 正文/剧本/待确认卡/扮演转正共用读取、写语义、备份和留痕；页面不是写协议本身 | `src/modules/prose/{chapters,chapterWrite}.mjs`、`src/protocol/{chapters,chapterWrite,changelog,hostWrite}.mjs`（后两类为协议/底座） |
| 4 | `text` | `text.analyze@1` | 纯函数文本分析同时服务浏览器、MCP、扮演去 AI 味闸和习惯 lint；若挂在「分析」工作台，会出现内核/服务端反向依赖 UI | `src/modules/text/analysis.mjs`；`public/analysis.mjs` 与 `src/protocol/text.mjs` 转供；MCP 与扮演经能力消费 |
| 5 | `deduce` | `deduce.engine@1` | 确定性回合执行器无 UI；规则由套件参数化，扮演只负责舞台与交互 | `src/modules/deduce/{index,deduceCapability,deduceEngine,deduceSession}.mjs`、`src/modules/deduce/engine/`、`suites/deduce-rules/` |
| 6 | `agent.runtime` | `agent.runtime@1` | Agent 存储、DSH/CLI/endpoint 上游、LLM port 是跨工作台服务；不拥有 Agent 栏界面 | `src/modules/agent-runtime/{index,config,credentials,dsh-cli}.mjs`；外围 bridge 与服务仍由协议能力组合 |
| 7 | `media` | `media.generate@1`、`media.describe@1` | 生图不是 LLM 对话运行时；识图虽可经 DSH 执行，产品能力仍是媒体输入/输出。单独成件才能让工作流套件替换参数而不换执行器 | `src/modules/media/{index,generate,describe,probe,comfyEngine}.mjs`；`src/protocol/media.mjs` 转供 |

**text 结论（建议）**：新增。分析页面可以停用，但 MCP 分析与扮演质量闸不能因此消失；把纯引擎留在工作台会造成 R3 的依赖倒挂。

**media 结论（建议）**：新增。`media.generate` 拥有 OpenAI 兼容生图与 ComfyUI 适配；`media.describe` 拥有识图 port，当前实现可调用 `agent.runtime` 的 DSH 通道。能力边界按产品职责划分，不按当前进程内 import 划分。

### 2.4 工作台三档：逐件归类与顺序

「创作面／工具面」是工作台的两个产品档；「宿主面」是底座自带的组成面，**不是第三个插件档**。

| 档 | 顺序 | 正名 | 归类理由 | 主要 requires（硬依赖） | 可选消费 |
|---|---|---|---|---|---|
| 创作面 | 1 | 正文 | 直接创作主稿 | `prose.write`、`fact.store` | `text.analyze` |
| 创作面 | 2 | 世界书 | 创作设定条目与关系 | `fact.store` | `media.generate`、`media.describe` |
| 创作面 | 3 | 剧本 | 剧本稿件创作 | `prose.write`、`fact.store` | `text.analyze` |
| 创作面 | 4 | 故事源 | 事实链的阅读、溯源与富化 | `fact.store`、`fact.enrich` | `agent.runtime` |
| 创作面 | 5 | 扮演 | 多角色交互与回合转正 | `deduce.engine`、`fact.store`、`prose.write` | `agent.runtime`、`text.analyze` |
| 工具面 | 1 | 习惯 | 写作规则编辑与 lint 入口 | `text.lint`、`prose.write` | — |
| 工具面 | 2 | 产物 | 跨目录产物盘点与恢复 | `prose.write`、`prose.changelog` | — |
| 工具面 | 3 | 日志 | 跨模块 diff/log 自检索 | `prose.changelog` | — |
| 工具面 | 4 | 分析 | 指标、图表、批注与定位 | `text.analyze`、`fact.enrich` | — |
| 工具面 | 5 | 知识库 | 知识集合与检索入口 | `storage.roots`、`agent.embedding` | `agent.runtime` |
| 工具面 | 6 | 生图与识图 | 媒体能力配置、生成与白描入口 | `media.generate`、`media.describe` | `agent.runtime` |
| 工具面 | 7 | 导入导出 | 数据进出与格式适配 | `fact.store`、`storage.roots` | `prose.write` |
| 宿主面 | 1 | Agent 栏 | 底座自带对话面，消费 runtime/prose/text，不是可停用创作插件 | `agent.runtime`、`prose.write` | `text.lint` |
| 宿主面 | 2 | 设置 | 底座本体设置与插件管理 | 仅 `base.*` | — |
| 宿主面 | 3 | 库管理 | 底座自带库清单/建库/导入面 | `storage.library`、`storage.scaffold` | — |

**两档是否成立（建议）**：成立。创作面直接产出或组织作品内容；工具面提供跨作品流程、质量、素材与数据服务。两档只用于产品说明和默认 slot 编排，不制造新的 class。

**宿主面处理（建议）**：Agent 栏、设置、库管理作为底座组合面登记，不套 `class:workbench`。现 `agentbar`/`library` manifest 因此不是简单升版，而是拆成「内核能力＋宿主组合面」。若作者希望它们可停用，再另立裁定，不在本稿默认放开。

### 2.5 六种创作套件供给：逐件归类与顺序

| 顺序 | 套件供给 | `supplies` 值 | 为什么是套件／执行边界 | 当前落点 |
|---|---|---|---|---|
| 1 | skill 包 | `skill` | 提示词与手艺配方是数据；Agent 执行，套件不加载代码 | `skills/`、`src/services/skills.mjs` |
| 2 | 推演规则包 | `deduce-rule` | 2d6、局面卡、候选模板是可替换规则数据；确定性仍在 `deduce.engine` | 现规则散在 `src/modules/deduce/engine/` 与角色模块，后续析出 |
| 3 | 生图工作流包 | `media-workflow` | ComfyUI 工作流 JSON、节点映射与参数预设是数据；执行在 `media` | `src/modules/imagegen/` 与用户配置，后续析出 |
| 4 | 文风包／体裁包 | `resource`＋`resourceKind=style|genre` | 色板、体裁、篇幅与页签裁剪是声明式资源；storage 只执行模板 | `styles/`、`genres/`、`src/services/{stylePacks,genres}.mjs` |
| 5 | 运行时套件 | `runtime` | CLI kit 的 endpoint/probe/command 是**受控扩展描述**，不是可导入插件代码；适配器在 `agent.runtime` | `runtimes/`、`src/services/runtimes.mjs` |
| 6 | 业务套装 | `bundle` | 只捆绑上述供给与依赖闭包，不另造执行器 | `suites/`、`src/services/suites.mjs` |

**运行时套件归属（建议）**：保留在 suite 的 `runtime` 供给类型，作为 `agent.runtime` 的受控本机扩展；不单列第四个 class，也不把 kit 目录当可导入代码包。理由：`src/services/runtimes.mjs:normalizeRuntimeKit/ensureSidecar/probeRuntimeKit` 确实有 `command.cmd`、`spawn` 和 sidecar 生命周期，不能伪装成纯静态资源；但产品职责仍是「给 Agent 运行时换通道」。

**安全前提**：suite 目录不得包含 `.mjs/.js/.cjs` 等宿主可执行代码；runtime manifest 只能描述宿主已实现的命令协议。第三方 runtime 在 D 批前不开放；开放时必须增加作者信任、命令允许范围与可执行文件指纹校验。当前 CLI kit 允许绝对 `probe.cmd`，这是本机可信 legacy 行为，不能直接外发给第三方。

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

**内容**：`NAMING_TABLE`、slots 注册、能力 id 语法与注册表、错误码注册。显示名词表当前仍在 `public/views/registry.mjs`，由 `src/protocol/naming.mjs` 转供；能力实现已汇集到 `src/protocol/capabilityImplementations.mjs`，但命名数据源的最终归属仍属后续批次。

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

1. **B0 进程底座**：初始化进程/网络、锁、stamp/generation、错误信封、内置源路径；此时不读库清单。
2. **B1 内置内核发现**：只扫描随包固定目录，校验 manifest，不扫描本机院子。
3. **B2 storage 优先**：装载内置 `storage`，由 `storage.roots` 提供本机院子、货架源与库清单解析；若缺席，只跳过本机源，不阻止 daemon 启动。
4. **B3 内核图检查**：对其余内置内核件做闭环/冲突/覆盖合法三检查；生成第一份不可变路由快照。
5. **B4 工作台登记**：校验工作台 manifest、slots/pages/endpoints 与 hard/optional requires；不执行页面代码。
6. **B5 套件装载**：读取内置与本机套件源，解析 supplies/resources/deps；本机源只有通过信任策略才进入候选。
7. **B6 全图复检与激活**：把工作台与套件贡献加入候选图，再次执行三检查；通过后原子切换快照，未通过项进入启动报告并降级。
8. **B7 请求服务**：所有请求读取当前快照；切换时新请求用新快照，在途请求继续持有旧快照句柄。

### 4.3 底座 requires 与保底者

| 底座能力 | 是否影响进程启动 | 保底供给 | 缺失结果 |
|---|---|---|---|
| `base.process`、`base.loader`、`base.contract`、`base.write`、`base.naming` | 是；底座自身实现 | 底座 | 不存在「缺底座还能启动」语义；实现损坏是发布阻断 |
| `storage.roots@1` | 否 | 内置 `storage` | health 正常；不扫本机源、不授权库，启动报告记断链 |
| `storage.library@1` | 否 | 内置 `storage` | 库管理宿主面降级 |
| `prose.changelog@1` | 否 | 内置 `prose` | 日志宿主面降级；其他写作能力按自身依赖判定 |

**建议**：底座最小 requires 只包含完整宿主面所必需的 `storage.roots/storage.library/prose.changelog`；它们不是 `core:true` 的翻版，而是能力图里的硬边。缺少它们不拖死 daemon，但对应宿主面明确不可用。

### 4.4 能力路由形态

**建议一步到位使用薄代理**：插件只拿 `resolve(capabilityId, range)` 返回的稳定句柄；句柄绑定一个不可变快照。禁止插件长期缓存裸函数引用后再假定路由永不变化。重建路由必须先完整校验，再切换指针；未校验热替换不允许。

---

## 五、四个开放问题的建议结论

### 5.1 storage × genres

**现状**：`src/modules/storage/projectDoc.mjs:PROJECT_KINDS/createProject/resolveClosure` 拥有骨架目录、载体与建库流程，`storage` 已解析 `base.write`／`base.naming`；`src/services/genres.mjs:normalizeGenre/allowedDirs/briefPromptSection` 仍拥有 `deliverables/excludedPages/agentPolicy`。体裁尚未拆成可替换 suite，能力图仍不能表达体裁模板闭包。

**建议**：

- `storage` 拥有 root、清单、目录安全与「按已验证模板建骨架」的执行器。
- 体裁包拥有骨架模板、交付物、`excludedPages`、篇幅与 Agent policy。
- storage 不解释体裁规则；genre 不直接写盘，只能声明模板。
- 内置最小模板作为保底资源随包；缺体裁资源时 generic 建库仍可用，体裁专属页签不出现。

### 5.2 jobCenter／events

**现状**：`src/protocol/index.mjs` 明确 jobs/events 为进程内、不落盘；`src/services/jobCenter.mjs` 是单一 Map，重启即清。

**建议**：归底座。它们是进程服务，不是创作能力；长任务的业务执行器可以由插件提供，但登记、查询、取消、订阅与 SSE 帧投影由底座统一。若未来任务需要跨重启恢复，另立 ADR，不把「未确认内容必须落盘」偷换成「所有瞬时进度必须持久化」。

### 5.3 套件声明式逻辑边界

**现状**：skills 是 Markdown 配方，styles/genres 是 JSON，runtimes 含命令描述，suites page 模式允许 `.html/.mjs/.js/.css` 同源 iframe，见 `src/services/suites.mjs:ASSET_ENTRY/normalizeCapabilities`。因此当前 suite 不是完全无代码。

**建议**：

- 新 `module@2 class:suite` 只允许有限 JSON Schema 描述的参数、条件分支、枚举与资源引用；允许数据驱动 DSL，禁止图灵完备脚本、宿主 import 与动态 `eval`。
- 禁带 `.mjs/.js/.cjs`、内联脚本 HTML、WASM、shell 片段与迁移器。
- 现有 `openstory-suite@2` page 模式作为 legacy 孤岛继续由旧 loader 处理，**不宣称符合新 suite 协议**；迁移前宿主必须提供 schema 渲染或新的受控页面协议。
- runtime kit 的命令描述是受控数据，不是 suite 代码；命令执行能力仅在 `agent.runtime` 适配器内。

### 5.4 naming 双端方案

**现状**：`src/protocol/naming.mjs` 直接 re-export `public/views/registry.mjs`，原因是浏览器 leaf 注册表有零 import 门禁。

**建议**：词表最终归底座，不由前端模块拥有。B/C 批可暂留现有 re-export 作为迁移态；C 批把唯一数据源移到底座可提供的中立模块，daemon 在首个业务渲染前下发只读命名投影，前端注册表只保存视图行为与投影消费结果。迁移必须同时改 `test/tabRegistry.test.mjs` 的零 import 约束，不能复制第二份字面量。

**备选**：若作者希望保持首屏零网络，可接受「底座数据模块生成前端静态投影」；生成物不是第二真源，但必须由门禁验证与源一致。默认推荐运行时投影，因为插件装载后命名必须同源。

**D 批实况（2026-11-25）**：暂不迁移。现表本体在 `public/views/registry.mjs`、后端 `src/protocol/naming.mjs`
只 re-export，全仓仍只有一份字面量（`test/naming.test.mjs` 门禁钉死）；运行时投影会为首屏页签引入
网络依赖，生成静态投影则要放宽注册表零 import 门禁并引入第二份生成物。两项都不优于现状，
故保留「单一数据＋双端消费」并交后续批次在需要插件新增命名时再评估。`base.naming` 已提供只读投影，
D4 的 slot 注册表也已并入该投影（`SLOT_REGISTRY/isRegisteredSlot/slotEntry`）。

### 5.5 能力路由的进程内形态

**建议**：薄代理＋不可变快照，详见 §4.4。该问题与 R8 合并裁定。

---

## 六、R1–R14 逐项处置

| # | 处置 | 结论与理由 |
|---|---|---|
| R1 | **采纳** | 三条反转在 §七明文留痕；既有真库升级与作者验收边界不能因新架构消失。 |
| R2 | **采纳并改写** | 不是一条线性装载序，而是 B0–B7 两阶段图检查；storage 先解决源发现，字面零插件仍可启动。 |
| R3 | **采纳** | 新增 `text` 内核件；`public/analysis.mjs` 的纯函数与「分析」工作台拆开，MCP/扮演/习惯不再依赖 UI 模块。 |
| R4 | **采纳并补错误码** | hard requires 导致「拒绝停用」返回 `CAPABILITY_IN_USE`；启动/切换时缺失导致消费者不装载或降级，返回/报告 `PLUGIN_DEGRADED`。`MODULE_DISABLED` 继续表示工作台被作者停用。 |
| R5 | **采纳** | daemon 永远先启动；缺能力插件不装载，`GET /api/plugins` 启动报告列断链，health 仍只报进程事实。 |
| R6 | **采纳并收窄** | suite 只有资源覆盖，禁止迁移器；capability 覆盖与其迁移器只能来自 kernel。workbench 的表面覆盖不得改落盘格式；若需要格式升级，先拆出 kernel 供给者。 |
| R7 | **采纳** | 底座只保留 `base.*` 与 id 语法；其他能力 id 启动时登记。注册表不是写在词表里的永久白名单。 |
| R8 | **采纳** | D1 热更新是「候选快照→三检查→原子切换」；在途请求持旧快照，禁止未校验替换。 |
| R9 | **采纳** | `pages[]` 只留 id/label；嵌入点统一由 `slots[]` 的 `{slot,page}` 声明，不再两处写 slot。 |
| R10 | **采纳** | 默认推演规则包绑定确定性金样；同种子＋同事实包＋同规则＝同拍。换规则包必须提供新金样。 |
| R11 | **采纳** | 新增 `media` 内核件；生图工作流套件只供 JSON，执行器不再归 `agent.runtime`。 |
| R12 | **采纳** | 本稿只用当前实测：14 模块、4 个 core、105 端点、27 项验收、702 例（700 过/2 跳过/0 挂）、`app.js` 11,838 行；规划旧数字只作历史。 |
| R13 | **采纳，已在 OS-169 收口** | 测试使用临时 `LOCALAPPDATA` 与夹具库；不靠本机 CLI/模型/真目录。OS-173 不改测试。 |
| R14 | **采纳，已在 OS-172 收口** | 去 Pinax 影响面已由 OS-172 的八类现状盘点承担，不再依赖仓外「影响面·六」。 |

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
| `DEMO.md` 口径 | `docs/DEMO.md` 只留《水浒传》 | 已实现；Agent 栏仍写 Pi-Agent 归本稿后续命名批 |
| 三份 Pinax 对标/历史规划 | `docs/plan/{decouple-pinax-core-20261122,kernel-own-design,route-batch2-20261123}.md` 顶部均标「历史文档，现状以 OS-172 为准」 | 已实现 |
| 台账「桌面端开新库确认」 | `docs/LEGACY-ITEMS.md` 已无该动作；真库首次打开看升级报告保留为作者动作 | 已实现 |
| 真实出处 | `docs/kernel-provenance.md`、README 致谢 | 必须保留，不属于品牌关联 |

---

## 八、B 批实施结果与剩余边界

1. B1–B3：14 份 manifest 已升 @2；能力图三检查与候选状态事务已落地；模块级 `core`／`MODULE_CORE` 已删除。页签注册表的 `core:true` 只表示顶栏可达，不再控制模块启停。
2. B4：`deduce` 归内置 kernel；`agentbar`／`library` 归宿主组合面，恒启用且拒绝停用键；来源记录带目录与 manifest 哈希。`storage`／`agent.runtime` 的代码拆分仍属 C 批，未提前伪装完成。
3. B5：`deduce.engine@1` 已由 kernel manifest 提供，`roleplay` 声明硬依赖；推演 handler 经按库薄代理解析能力，外部端点与 MCP 名不变。完整动态 `activate` 与全局热切换仍未实施。
4. Agent 栏标题 `Pi-Agent`、产物标题「产物中心」、故事源空态「世界书/条目」、`namingEntry('reference')` 旧 id 调用需要后续正名批。
5. 「识图」已有 `/api/vision/describe` 与世界书图片入口，但设置说明承诺的按钮文案尚未在业务视图落地；不得把 MCP 工具存在当成 UI 已接通。
6. 自定义目录入口承诺「建目录并加页签」，但 `dirTabDefs()` 只物化注册表词表内目录；这是既有行为不一致，不由插件协议掩盖。
7. 当前 suite page 模式含可执行资产；新 suite 协议上线前必须保留 legacy 隔离，不得直接给它贴 `module@2` 标签。
8. 当前所有货架「后装载覆盖先装载」必须改为显式 override；B 批可保留 legacy 读取，C/D 批不得静默覆盖。
9. 旧 `core:true` 不能推断为 kernel；除已归位的 `deduce` 外，chapters/analysis/comfyui 等仍待按 §2.3/§2.4 拆出内核能力。

---

## 八·补、C6 架构门禁与数字锚实施记录

C6 只修改 `tools/**`、架构/数字锚测试、`docs/**` 与 `ARCHITECTURE.md`，不修改 `src/**`、
`public/**`、`package.json`、`.zcode/**`，不提交，也不触碰真实用户库。历史 §八保留原样。

1. **规模统计去旧层号**：`tools/arch-stats.mjs` 直接读源码与 manifest，按底座、契约、协议、
   七内核件、工作台、宿主组合面、服务、套件资源与前端生成规模；不执行 `activate`，不受运行时导入环影响。
2. **当前清单**：20 份内置 manifest＝7 kernel＋11 workbench＋2 宿主组合面；生产装载显式 stage C。
   stage B 只留给迁移/双读测试；缺 class 的非宿主包、kernel 缺 capabilities、kernel 带 core 均在 C 拒绝。
3. **能力路由门禁**：S2.1 扫描静态与动态 import；模块只准 node 内置、协议、本模块与点名的套件资源。
   API/services/host/protocol 直连模块仅限显式兼容转供叶，并比较大函数体，禁止复制实现。
4. **底座门禁**：S2.4' 禁止 kernel 反向依赖、host 私接模块/前端、core/vendor 路径回潮与底座外复制写实现；
   同时要求 base.process/loader/contract/write/naming 五项句柄真实存在。
5. **归属与动态门禁**：S2.7 合并 stage-C 覆盖、kernel 零 UI/端点、工作台 entry/requires/slots、
   端点唯一归属、能力图无错误，并在独立进程执行全部 `activate` 与贡献校验。27 项验收 id 不变。
6. **数字锚**：`APP_JS_LINE_CEILINGS` 追加 10,500 当前目标，保留 11,886 初始锚与“只降不升”历史断言；
   `docs/number-anchors.json` 由脚本回写。当前 `app.js` 实测与上限以生成物为准。
7. **不得误报的剩余项**：统一注册表漏登记、hard require 未在 activate 解析、S2.1/S2.4 指名的 src 边界债
   仍需主 agent 处理。门禁工具不得为了绿灯删断言或扩大无理由豁免；外部 endpoint/MCP 名保持不变。

---

## 九、待作者裁定

主 agent 按下列方案实施；后续批次如作者调整，以新的明确裁定为准。

| # | 请作者过目 | 主 agent 建议 |
|---|---|---|
| D1 | 三名一致表与七内核件顺序 | 通过 §二；`text`、`media` 新增，顺序 storage→fact→prose→text→deduce→agent.runtime→media |
| D2 | 工作台分创作面/工具面，宿主面归底座 | 通过；故事源独立，不并入导入导出；Agent 栏/设置/库管理不做可停用工作台 |
| D3 | `生图与识图`／`知识库` slug | 分别用 `imagegen`／`knowledge`；外部端点与 MCP 工具名不动 |
| D4 | runtime kit 归属 | 作为 suite 的 `runtime` 供给、`agent.runtime` 的受控扩展；第三方命令执行须另过信任门 |
| D5 | 宿主域旧模块拆法 | `deduce→kernel`；`library→storage kernel＋库管理宿主面`；`agentbar→agent.runtime kernel＋Agent 栏宿主面`；不做 14 份 manifest 的一对一升版 |
| D6 | naming 最终归属 | 词表归底座，前端消费只读投影；B/C 迁移期可暂留 re-export，最终不留双真源 |
| D7 | suite 边界与 legacy page 模式 | 新 suite 无宿主可执行代码；现 page 模式留旧 loader 隔离，迁移前不开放第三方 |
| D8 | 底座硬依赖与停用语义 | 完整宿主面硬依赖 `storage.roots/storage.library/prose.changelog`；缺依赖不拖死 daemon，hard consumer 存在时拒绝停用供给者 |

---

## 十、作者裁定记录

- 2026-11-25：作者明确要求不再等待旧工单逐项批准，按已写细规划继续各批实现。B1–B5 已据此实施；七内核件落盘与统一注册表、C6 门禁和数字锚已推进，源码边界清账、新 suite、本机/第三方装载及全局热切换仍属 C/D。
- 2026-11-25（D 批收口）：D1 覆盖路由＋回退链、D2 迁移器框架、D3 套件升格 `openstory-module@2`、D4 slot 注册表与动态装载评估均已落地；`base.process` 服务映射补齐。D4 裁定**本批不开放第三方可执行模块装载**，开门条件 G1–G5 见 [ADR 0003](0003-dynamic-loading.md)；数字锚回写 812 例／102 测试文件／105 端点／`app.js` 10,338 行／门禁 27 项。
