# AGENTS.md — OpenStory

> 给所有在本仓干活的 agent（Zcode / Qoder / Codex / Claude / CodeBuddy…）的入仓须知。
> 人在环：作者本人裁定一切；拿不准就问，别自作主张动稿。

## 这里是什么

零 npm 构建依赖的中文小说工作台：入口 `src/host/daemon.mjs`（实现文件直跑，OS-159 起仓根零垫片）：
node:http 手写路由，127.0.0.1:8807；
OS-127 进程治理：单实例锁＋stamp＋generation＋`/api/health`）
+ `public/` 原生 JS 前端。模块：**小说**（纯净写作面）/ **世界书**（世界书笔记＋故事源词条只读层）/
**习惯**（写作规矩表）/ **故事源**（fact 链可视化）/ **扮演**（主持人＋多角色，默认）/ **确定性推演**（可选）/ **剧本** / **分析**（本地引擎）。
全部经契约层（`src/api/contracts.mjs` 聚合 `src/api/contracts/` 八域分片，108 端点）分派；
MCP 对外 24 工具（`src/host/mcp.mjs` 直跑；stdio 独立进程，数据操作走 daemon HTTP 薄适配）。
分层见 [ARCHITECTURE.md](./ARCHITECTURE.md)：OS-173/C6 起不再用 L7–L2 旧层号；按
前端 `public/` → 契约 `src/api/` → 底座 `src/host/` → 协议 `src/protocol/`＋能力句柄 →
`src/modules/`（七个内核件＋工作台＋宿主组合面）→ 物理写管道 `src/kernel/` → 磁盘库 描述依赖方向。
`src/kernel/` 只留写管道、错误词表与身份五个文件；fact 链与 enrich 已归 `src/modules/fact/`。

## 硬规则（违反＝白干）

1. **内核自有、磁盘格式名冻结**：内核身份 `openstory-kernel@1`，实现只在 `src/kernel/**`
   （物理公开面 `index.mjs` 为 `KERNEL_ID/KERNEL_NAME/KERNEL_VERSION/ok/fail/writeFileAtomic`；身份 `identity.mjs`）；
  业务能力已降为 `src/modules/` 下七个 manifest@2 kernel：storage/fact/prose/text/deduce/agent-runtime/media。
   由 Pinax-next `feat/pinax-electron-next`@`70a4f44` 于 OS-152→157 逐步转自有，@pinax/core
   0.16.0 的世界书契约转为 `src/modules/worldbook/worldbookFileContract.mjs`，
   逐文件「来源 → 现位置」见 `docs/kernel-provenance.md`。`core/`、`vendor/` 与
   `npm run vendor:check` 已整体退役（OS-157）；门禁 S2.4' 钉死 `src/**` 与仓根
   不得出现 `core/` 路径说明符。磁盘格式名冻结：`.openstory/project.json`＝`openstory-project@4`
   （`schemaVersion: 4`，carrier＝`openstory.carrier.*`）、`故事源/*.json`＝`fact.data/v3`、
   `*.wiki.json`＝`openstory-wiki-derived@2`、`.openstory-tmp-*` 临时前缀——变更须连
   金样与迁移夹具一起评估。旧名只作一次性迁移输入：旧库先备份，再迁到新运行态与目录，
   成功后旧目录改名留档；读侧只认新布局，不维护 `.pinax/` 与 `.openstory/` 长期双读。
   写协议只经 `factFileStore.writeFactFile`，宿主写通道只经 `src/protocol/hostWrite.mjs`；模块不直引
   内核，只经能力句柄（`activate(context)` 的 `context.resolve`）或底座契约（OS-195 转供叶已清零）。
   推演 8 件（opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState）
   归 `src/modules/deduce/engine/`——它是产品引擎，不是内核；OS-195b 起第二套
   `host-api@2` 命名空间入口已退役，能力只经 `capabilityImplementations.mjs` 登记表与句柄取用。
2. **daemon 只监听 127.0.0.1**；凭据只存本机（agent-config.json），响应只回掩码。
3. **世界书单向性**：正文不反向进世界书上下文；世界书不能全量丢进 Agent 上下文。
4. **absorb 不开 MCP**：旧目录迁入世界书是显式动稿操作，只走界面按钮。
5. **MCP 不开 agent 对话**（不套娃）；写操作一律有 .history 备份。
6. **边界四条（OS-195 立，OS-195a 收口；门禁 S2.1／S2.4'／S2.7／S2.11 直接数静态 import，无白名单）**：
   - **归属（OS-195a）**：模块自己的实现住在自己的目录里，`src/modules/**` 不许有「只从 protocol 转供」的空壳。
     `src/protocol/` 只放底座契约——纯函数或只读的路径／形状／词表／校验逻辑；做 I/O 的只有
     `src/protocol/README.md`「登记在册的 I/O 例外」表里的那些文件，协议层零 `fetch`／`spawn`。
   - **消费路径（OS-195a，谁要用别人模块的东西只有这四条）**：
     ① 内核件的东西 → 能力句柄（`context.resolve(id)`）；
     ② 宿主组合面（`agentbar`／`library`）的东西 → 只有宿主可直接 import，别的模块走端点分派；
     ③ 工作台要给宿主（含 Agent 栏）东西 → 经 `activate()` 贡献**钩子**，宿主按库快照取（模块停用＝钩子消失）；
     ④ 工作台要用别的工作台的东西 → 经底座端点分派（`handlerFor(endpointId, root)`），不 import 对方内部。
     钩子名登记在 `src/protocol/moduleActivation.mjs`（`beforeWrite`／`promptContext`／`referenceIndex`／`startup`），
     未登记拒收；宿主取钩子的唯一口是 `src/host/moduleHooks.mjs` → `handlerTable.hooksFor()`，不留第二套注册方式。
   - **R-a 内核实现只有一个静态入口**：只有 `src/protocol/capabilityImplementations.mjs`（实现登记表）可静态
     import 内核实现；其余位置（含工作台、宿主、服务、协议其他文件）＝0。内核之间只经 `context.resolve` 句柄。
   - **R-b 工作台内部实现只许本模块的 handler 与前端视图触及**：宿主、底座服务、别的工作台静态 import 它＝0；
     唯一放行的跨目录 import 是「宿主 → 宿主组合面」（`src/modules/agentbar/`、`src/modules/library/`）。
   - **R-c `src/protocol/` 只留底座契约**：文件清单与 `src/protocol/README.md` 逐一对上（多一个没登记就红）；
     `export ... from '../modules/…'` 转供叶＝0，复制模块实现函数体＝0。
   - **R-d `src/services/` 只留底座服务**：只留五个货架装载（`genres`／`runtimes`／`skills`／`stylePacks`／`suites`）
     ＋ `systemPrompt`／`syncCheck`；OS-193 的十个内核兼容叶已删，一律改经 `resolve*Capability(root, …)` 句柄。
   建库/导入/章节号解析已**本仓自持**（`src/modules/storage/projectDoc.mjs`）；整目录导入实现在
   `src/modules/library/importAdapter.mjs`，格式适配在 `src/modules/library/textUtil.mjs` 与
   `src/protocol/worldbookContract.mjs`（OS-123/124 fork 点），不再复用上游内核。
   > **模块插件（OS-144；B1–B5 已升级，OS-192 单规则收口）**：工作面使用 `src/modules/<id>/module.manifest.json`
   > （`openstory-module@2`：`id/name/version/class/endpoints/pages/slots/settings`；@1 直接拒收，迁移脚手架已删）。
   > 五类货架（skills/styles/genres/runtimes/suites）经 `src/protocol/shelfManifests.mjs` 投影成同一份 module@2 套件清单，
   > 与模块共用能力图；启停与设置值统一落 `.openstory/plugins/suite-state.json`；本机覆盖内置必须显式报告。
   > legacy `openstory-suite@1/@2` 页面模式、`/suite-assets/` 路由与两个 state-data 端点已退役。
   > `endpoints` 只登**独占**端点——共用端点（如 fact 读）不登记，停用任何模块都不许让它失效。
   > 启停判定与端点归属只有单一入口 `src/protocol/modules.mjs`；状态落库内 ui-state
   > `modules.enabled.<id>`（缺省 true，值不删），写入前必须通过 `capabilityGraph.mjs` 候选图事务。
   > 模块级 `core` 与 `MODULE_CORE` 已删除；四个原核心工作台与普通工作台一样可停用，停用回
   > `MODULE_DISABLED`（409），能力缺失回 `PLUGIN_DEGRADED`（503）。页签注册表的 `core:true`
   > 只表示顶栏可达，不控制模块启停。`deduce` 是供给 `deduce.engine@1` 的内核件；`agentbar`／`library`
   > 是恒启用的宿主组合面，不接受停用键；设置页只给 workbench 渲染启停卡。两层插拔各存各键、
   > 互不覆盖：右栏分析卡片级 `analyzeEnabled`（旧）vs 整模块级 `modules.enabled.<id>`（本层）。
   > 新增 module manifest 必须过 `test/modulePlugins.test.mjs` 的形状校验。
   > **设置归一（OS-145/146）**：设置页只有一个入口——**内核设置区**（daemon 端口语义、库路径、数据目录、
   > 凭据存储，L5 宿主所有，不插件化）＋**各模块自报设置区**（manifest `settings`，字段口径
   > `{ key, label, type: string|number|boolean|select, default, options? }`，值落 ui-state
   > `modules.settings.<id>.<key>`）。聚合与渲染是纯函数，在 `public/views/settingsAggregation.mjs`，
   > app.js 只取数调用（OS-143 增量冻结）。旧配置键一次性迁移，marker `modules.settingsMigrated` 防重复；
   > 停用模块＝设置区压暗不可编辑、值保留。凭据仍只存本机（agent-config/kb-config），不进 ui-state。
   > **OS-146 铁律：界面上出现的每个设置项必须有真实消费者**——生图/识图真源是 agent-config.json、
   > 知识库真源是 kb-config.json、右栏卡片开关是 ui-state `analyzeEnabled`，这些**不许**在设置页再摆一份
   > 输入框；真配置在别处的模块只写 `settingsHint`（一句指路）＋`settingsJump`（设置页区块 id），
   > 渲染成一行说明＋跳转按钮。守卫 `test/moduleSettingsConsumers.test.mjs`（键→消费者文件:符号 表，
   > 新键不在表里＝红）。
7. **布局宪法（OS-140）**：仓根只允许「入口、包描述、文档」——OS-159 起仓根零 `.mjs`，
   daemon 与 MCP 均由 `src/host/` 实现文件直跑；实现文件不得再放仓根。自持模块全部收进
   `src/` 六目录，新模块一律入对应子目录：

   | 目录 | 内容 |
   |---|---|
   | `src/host/` | daemon/mcp 实现（组合根：路由、进程治理、路径解析） |
   | `src/api/` | 契约层 `contracts.mjs` ＋ `contracts/` 八域分片（API 形状唯一真源） |
   | `src/protocol/` | 底座契约层（逐文件理由见 `src/protocol/README.md`）：形状/错误信封、路径安全、授权、写管道、装载协议、能力图与迁移、slots、命名取表口、旧库一次性升级、进程内事件词表，以及与工作台无关的格式/路径纯函数；零转供叶 |
   | `src/kernel/` | 自有物理内核（`openstory-kernel@1`）：公开面 `index.mjs`＋身份 `identity.mjs`，管道件 `errors.mjs`/`atomicWrite.mjs`/`fsDurability.mjs`；业务 fact/enrich 已降为模块内核，core/、vendor/ 已退役 |
   | `src/modules/` | 21 份 `module.manifest.json`：12 个 workbench（chapters/script/worldbook/storysource/roleplay/analysis/imagegen/knowledge/habits/artifacts/log/exchange）、7 个 kernel（storage/fact/prose/text/deduce/agent-runtime/media）、2 个宿主组合面（agentbar/library，恒启用）；library/ 建库导入、storage/ 库骨架、deduce/ 推演、roleplay/ 扮演、worldbook/ 世界书、agentbar/ Agent 存储 |
   | `src/services/` | 底座服务与货架资源装载：货架（skills/styles/genres/runtimes/suites/stylePacks）、跨内核底座服务（systemPrompt/syncCheck）与 OS-193 遗留内核兼容叶；jobCenter/nativePicker/uiPreferences 已归 `src/host/` |

   实现文件不得再放仓根；仓根 `.mjs` 计数必须为零。门禁 S0.1 钉死仓根零 `.mjs`。
8. **前端令牌单一真源**：颜色进 `public/index.html` 的 `:root`（同步 `design-system/tokens.css`）；
   样式令牌区外禁止裸色值。侧栏=绝对定位浮层，正文恒居中（OS-48 宪法）。
   组件约定见 `docs/UX-STRUCTURE.md`。

## 本机模块（OS-196 立，OS-196a 返工；可执行代码的四道门）

**信任模型：可执行模块与 daemon 同进程、同权限。登记一个模块根，等于信任这个根目录下所有模块的代码。**
**边界门不是沙箱**：它只挡住「import/require 解析越出包目录」与误用，挡不住同进程代码直接摸
`process`、`node:fs` 或生成新代码——`eval`/`Function` 做的事在进程内无法可靠禁止。预览的风险说明照原样显示。
登记入口必须有清单预览与明确确认（`confirm:true`），不提供「扫描任意目录」的捷径。
内置 `src/modules/` 永远是内置层；本机层同 id 覆盖内置层，`/api/plugins` 显式列出来源与摘要。
套件照旧只许数据，本机模块根里发现的 `class:suite` 一律跳过。

| 门 | 守护点 | 判定 |
|---|---|---|
| **G1 信任门** | `src/host/moduleRoots.mjs` 读写机器级信任表；设置页「本机模块」区先预览后确认 | 只枚举显式登记的根；未登记的根不扫描、不装载、不出现在报告里 |
| **G2 身份门** | `manifestSha256`＋入口与包内传递依赖（含 JSON 数据）的 `contentSha256` 进快照 id 与激活缓存键；`src/host/moduleBoundaryHooks.mjs` 给包内每个 import 追加逐文件摘要 | 同版本改入口／依赖／JSON＝新代码真的生效；与登记摘要不符标「内容已变」；Node 无解析钩子时如实报「需重启 daemon」，不冒充新代码 |
| **G3 边界门** | **运行期强制**：`src/host/moduleBoundaryHooks.mjs` 用 `module.registerHooks({ resolve })`，包内发出的 import/require 只许解析到 `node:` 内置或同包 realpath 路径；`src/protocol/localModuleBoundary.mjs` 静态扫描降级为预览提示（点名注释吞 import、改名 createRequire、转义 eval、间接 eval、裸 Function/AsyncFunction、getBuiltinModule、计算属性取 createRequire） | 越界在加载那一刻抛错并标 `gate:boundary`；静态提示不是唯一依据；`engines` 抬到 `>=22.15.0`（`registerHooks` 最低版本），不支持时如实降级而非假绿 |
| **G4 切换门** | `src/host/moduleRuntime.mjs`：先 manifests 层做端点归属＋三检查 → 淘汰违规模块（不跑 `activate`）→ 只激活合格者 → 校验贡献 → 重做检查 → 一次同步赋值 | 新请求用新层；在途请求持旧句柄到底；**淘汰按模块算**，同根其它模块照常；端点与 slot 归属随层回收 |
| **失败门** | 任一门失败＝当前快照不动、坏模块跳过、warning 进报告 | `/api/plugins` 与 `/api/module-roots` 如实报出是哪一门（`gate`）与原因；报告 `rejections` 逐模块点名 |

**端点归属规则（OS-196a）**：本机模块只能 (a) 注册自己的新端点，或 (b) 按 id 覆盖某个内置模块时接管
该模块的端点；宿主自有端点（如 `uiStatePut`）与别的模块的端点谁都不能认领。`activate()` 贡献可带
`contracts: { <端点>: { method, path, request, response, errors } }`，路径必须在 `/api/modules/<id>/…` 下，
登记进当前层后与内置端点共用 `endpointFor`／`validateRequest`／错误信封（静态数字锚不统计运行期端点）。
本机贡献的钩子与 handler 同表：`handlerTable.hooksFor()` 合并本机层，按库快照停用即消失。

五件底座能力经 `context.base` 以只读句柄给本机模块：`process / contract / write / naming / loader`
（loader 只给 snapshot/manifests/sources，不提供 `activate`）。内置模块仍按 OS-193～195 口径。

## 本地化与可追溯（OS-89 作者立宪，不可协商）

作者口径原文：「所有的内容必须放在本地。对于已经落盘的内容，应该放在固定的落盘位置。
对那些还没有落盘的数据，比如用户还没有保存，或者像推演这种——处于推演阶段有一个文档，
但没有被用户真实认可并保存到正文里——这些都是要落到本地的，绝对不能放在任何浏览器缓存里。
所有的保存行为和储存行为都是基于本地的本地文件。所有的修改都要有 diff，都要有 log。
每一个模块在每次加载的时候，都要自己检索一遍跟自己相关的一些 log。」

9. **一切状态落本地文件，浏览器只做内存视图。**
   - 禁止用 `localStorage` / `sessionStorage` / IndexedDB 保存任何**内容性或状态性**数据
     （草稿、偏好、选中项、会话指针、模块开关…）。
   - 皮肤这类**没有库也要生效**的纯渲染偏好落服务端机器级文件（OS-158），不进任何浏览器存储：
     任何端口打开同一项目读同一份，清缓存不影响；字号等其余偏好一律落库内 `ui-state`。
   - 判据：**关掉浏览器、换一台机器、清缓存后，重新打开库必须完全复原。** 不能复原＝违规。

10. **落盘位置固定，不得散落。** 库内数据全部在库根固定位置，机器级文件列在末尾：
   | 数据 | 位置 |
   |---|---|
   | 项目标记与 carrier | `<库>/.openstory/project.json`（`openstory-project@4`，carrier＝`openstory.carrier.*`） |
   | 正文/剧本/世界书等稿件 | `<库>/<业务目录>/*.md` |
   | 故事源事实与 wiki 派生 | `<库>/故事源/<bookId>.json`（`fact.data/v3`）＋`*.wiki.json`（`openstory-wiki-derived@2`） |
   | 未保存的编辑草稿（作者正在写、还没提交） | `<库>/.openstory/drafts/<模块>/<id>.json` |
   | 推演中未被采纳的拍/会话（引擎态） | `<库>/.openstory/deduce/<bookId>.json`（多局 `<bookId>@<sid>.json`） |
   | 扮演容器（会话／归档／导出／素材） | `<库>/扮演/<bookId>/session.json`（主线）＋`sessions/<sid>.json`（多局）＋`active.json`（激活指针）／`归档/第N章.md`／`导出/会话-<bookId>-<sid>-<ts>.md`／`素材/{角色,场景,bgm}/*` |
   | 导入与导出的落盘文件 | `<库>/导入导出/` |
   | 界面状态（页签、模块开关、选中项） | `<库>/.openstory/ui-state.json` |
   | 套件（业务插件）启停与设置值 | `<库>/.openstory/plugins/suite-state.json`（OS-160 起随库走；机器级同名文件降为「没开库时的缺省」，旧库不迁移） |
   | 每一版修改的 diff 与日志 | `<库>/.openstory/log/<模块>/<yyyy-mm>.jsonl` |
   | 模块能力迁移日志与数据版本 | `<库>/.openstory/migrations/<能力>/<from>-to-<to>.json`（`openstory-capability-migration@1`，成功写 `done`；旧供给者再接到请求回 `DATA_VERSION_AHEAD`） |
   | 能力迁移前的数据快照 | `<库>/.history/capability-<能力>-<from>-to-<to>-<时间戳>/`（失败按 journal 自动恢复；不自动做降级迁移） |
   | 旧版原文备份（二进制快照） | 同目录 `.history/<file>.bak-<stamp>`（现有机制，保留；OS-137 起滚动保留：每文件配额 50 份＋日锚，绝不删最新，删除留痕 `.openstory/log/history-prune/`） |
   | 旧库一次性升级备份与升级报告 | `<库>/.history/upgrade-<时间戳>/`；`<库>/.openstory/upgrade.json` |
   | 升级后退役目录留档 | `<库>/<旧目录名>.retired-<时间戳>/`（只读留档，不参与运行） |
   | 本机凭据/模型端点 | `%LOCALAPPDATA%/OpenStory/openstory/agent-config.json`（含密钥，不入库） |
   | 机器级界面偏好（皮肤，无库也生效） | `%LOCALAPPDATA%/OpenStory/openstory/ui-preferences.json`（OS-158，不入库；任何端口共用一份） |
   | 本机库清单（root 白名单来源） | `%LOCALAPPDATA%/OpenStory/libraries.json`（OS-167/189：只认 `{schemaVersion,libraries:[{path,name,addedAt,source}]}`；`source=openstory\|imported`。非本产品形状只读告警、拒绝覆盖（按内容形状不按文件名）；库身份靠库内 `.openstory/project.json`，不靠本机清单） |
   | 本机模块根信任表（OS-196，机器级） | `%LOCALAPPDATA%/OpenStory/openstory/module-roots.json`（`openstory.module-roots/v1`：根路径、登记时间、登记时每个模块的 manifest／内容摘要；未登记的根不扫描、不装载） |

   旧库升级只针对请求中显式指定且已授权的 root，由 daemon 在模块闸与业务 handler 前调用
   `ensureLibraryUpgraded()`：先备份到 `.history/upgrade-<时间戳>/`，再迁移 `.pinax/` 运行态、
   `参考/→世界书/`、`拆解/→故事源/`、`推演/→扮演/`、`导出/→导入导出/`、项目与 wiki 谱系名、
   存量路径和日志模块名；同名冲突加 `.upgrade-<时间戳>` 后缀。成功后旧目录改名 `.retired-<时间戳>`
   留档并写 `.openstory/upgrade.json`，失败按 journal 回滚。标记保证幂等，运行态不保留长期双读。

11. **每一次修改都必须有 diff + log，且可被模块自检索。**
    - 写操作一律经 `src/protocol/changelog.mjs` 的 `recordChange()`：自动算 unified diff、
      写 `<库>/.openstory/log/<模块>/<yyyy-mm>.jsonl`（append-only，一行一记录）。
    - 每个模块**加载时**必须调 `GET /api/log?root=&module=` 取自己的近期日志，
      在界面上如实呈现（作者要能看见「这个模块最近改了什么」）。
    - 记录必须含：`at / module / file / op / actor / beforeHash / afterHash / diff / bytes`。
      绝不记录密钥、正文全文以外的隐私内容。

12. **推演拍、草稿等「未确认」内容同样必须落本地。**
    推演拍、Agent 待确认卡、未保存草稿都属于「已产生但未采纳」的数据，
    必须落在上表位置，禁止只活在浏览器内存或缓存里。采纳后才写进正文，但**产生时就要落盘**。

## 前端开发协议（OS-91 作者立宪，写任何 UI 前必读）

作者口径原文：「前端的 CSS 需要全局化，在全局设置中配置应用，明确规范好有几个大小档位，
正文模块和功能模块的字体大小档位区分开……交给项目级设置去做全局的主题设置，强制覆盖各个页签。
同时，项目级的约束里，加强前端开发的描述约束、协议等。」

13. **字号只准用令牌，禁止裸写 px。** 全站两条独立轨道：

    | 轨道 | 令牌 | 用于 | 档位 |
    |---|---|---|---|
    | **功能轨** | `--ui-fs-2xs / xs / sm / md / base / lg / xl / 2xl` | 按钮/表单/卡片/标签/表格/导航 | 紧凑·标准·大·特大（`--ui-scale` 0.92/1/1.08/1.18） |
    | **正文轨** | `--doc-font-size` + `--doc-line-height` | 纸面正文（阅读/写作） | 小·中·大·特大·巨（15/17/19/21/24px） |

    - 功能模块里**不要出现** `--doc-*`；正文纸面里**不要出现** `--ui-fs-*`。
    - 行高用 `--ui-lh-tight|normal|loose`；控件高度用 `--ui-ctl-h`；内边距用 `--ui-ctl-px` / `--ui-row-py`。
    - 新页面照抄 `habits-form`（OS-91 治理后的样板）：标签 `--ui-fs-sm`、控件 `--ui-fs-md`、
      辅助说明 `--ui-fs-xs`、间距 `calc(Npx * var(--ui-scale))`。

14. **档位是项目级的，由「设置 · 主题与字号」统一控制，强制覆盖所有页签。**
    - 存在库内 `.openstory/ui-state.json` 的 `typography` 键（`{ui, doc}`）。
    - 任何页签**不得**自行覆盖字号——页面只管用令牌，缩放交给项目设置。
    - 违反判例：习惯页曾把字号写死成 12/12.5/13px 三档混用，作者实测「表格框线、字体和大小都不对」。

15. **控件视觉必须统一。** 输入类控件一律：
    `border: 1px solid var(--line)` + `border-radius: var(--radius)` +
    `padding: var(--ui-row-py) var(--ui-ctl-px)` + `font-size: var(--ui-fs-md)`；
    聚焦态 `border-color: var(--accent)`，不用 outline。
    卡片面用 `--surface-card`，影用 `--shadow-card`（浮起才用 `--shadow-float`）。

16. **新增 UI 元素前先问：全局已有同款吗？** 有就用令牌，没有就先在 `:root` 加语义令牌
    （进 `design-system/tokens.css` 同步），再在页面里用——禁止在页面样式里发明一次性数值。

17. **新 UI 只用 `.uikit-*` 与令牌；老类只是兼容别名。** 完整组件清单、用法示例、
    交互契约与自检清单见 **[docs/UI-KIT.md](./docs/UI-KIT.md)** ——写前端前先读它。
    - 组件在 `public/ui-kit.mjs`（10 个：chipField/field/textInput/select/toolbar/
      card/emptyState/kvTable/buttonGroup/chipChip）
    - 老类（`.btn-primary`/`.btn-ghost`/`.icon-btn`/`.select`/`.file-input`/`.text`/
      `.kv-line`）已重写为与 uikit 同源的令牌组合，**不再新增变体**
    - 多值输入用 `chipField`（标签式），**不要**再用「一行一个」的 textarea

18. **间距也只准用令牌。** `--ui-gap-3xs|2xs|xs|sm|md|lg|xl|2xl`（全部跟 `--ui-scale`
    缩放）；页面级栅格允许 `calc(Npx * var(--ui-scale))`。
    专用可视化组件（`.ss-*` / `.ded-*` / `.ct-*` 等）**可以有自己的类名前缀，
    但字号/颜色/间距必须走全局令牌**——不允许另建一套像素体系。
    详见 [docs/UI-KIT.md](./docs/UI-KIT.md) 第 7 节。

19. **窄面板 / 嵌入适配有硬下限（OS-114，作者口径：「前端适配要加一些约束」）。**
    DSH 右栏停靠后工作台只有 480～675px 宽，窗口断点不能按「桌面宽屏」想当然写。
    - 纸面可读下限 `--doc-read-min`（320px）：`--doc-max` 在窄窗口/右栏停靠时不得
      低于它；再窄就让 `doc-scroll` 横向滚，**禁止把正文压成一字一行**。
    - 断点 **1000px**：≤1000px 时左右浮层（`.ref-col` / `.analyze-panel`）**不再用
      内边距让位**（248＋300 同时让位会把 675px 面板的正文挤到几十像素），改回纯覆盖
      抽屉，用页头「参考资料 / 分析本章」开合；参考资料左栏在窄面板里默认收起。
      ≥1001px 才保留 OS-88 的结构性让位。
    - 档位：≤1000px `--content-px` 16px、≤720px 12px；侧栏抽屉按 `min(原宽, 72vw~86vw)`
      收；页签只横滚不换行；页头标题降一档。
    - 交付前必须在 **675px（DSH 右栏停靠宽）** 与 **420px** 两档宽度自查：正文可读、
      页签可横滚、控件不裁切。断点按**宽度**写，不按设备名/面板名写。

20. **app.js 增量冻结（OS-143，作者立宪：活装配壳只减不增；OS-198 扩到 slot 编排）。**
    `public/app.js` 是消费壳。**「哪个工作面出现在哪里、什么顺序」只由 manifest 决定**：
    底座 `slotPlacements()`／`slotProjection()` 从 21 份 manifest 生成投影，`GET /api/plugins`
    下发 `slots`（每项 `{slot,page,module,label,view}`，iframe 另带 `entry`），前端照投影渲染。
    OS-200 起同一响应还带 `modules[].requires/dependents/status/toggleCheck` 等推导字段、顶层
    `moduleGraph` 与套件货架四键；槽位降级件带 `degraded:true`＋`missing`。启停闸、快照与投影
    同源取 `graphInputsFor()`，推导只在 `projectModuleGraph()`，前端整体留一份 `state.plugins`。
    `public/views/registry.mjs` 的 `TAB_REGISTRY` **只是视图行为表**（页面 id → 渲染名/图标/
    作用域/可关闭/可见条件），不再有页签名、目录归属、模块归属或顺序。自此：
    - 新增内置页签＝manifest 加 `pages[]` 与 `slots[]` 位置，需要渲染时再在 `TAB_REGISTRY`
      登记行为；**不要在前端另写页签名单或顺序**。第三方页面用
      `pages[].kind:'iframe'`＋`entry`，daemon 只对已登记本机模块开 `/module-page/<id>/<entry>`。
    - **app.js 只许减不许增**（修 bug 除外）；视图渲染函数本体**只出不进**——
      迁出（G5 起逐个搬去模块）时在 `VIEW_RENDERERS` 插座改注册名，注册表只存名字、
      绝不 import app.js（依赖方向恒为壳→表，门禁 S2.2 扫描面已含 views/registry.mjs）。
    - **OS-146 补钉**：app.js 只留**接线**（取数 → 转交，必要时一行占位）；
      **视图渲染函数一律在 `public/views/`**，写在 app.js 里算违约（判例：
      `settingsModuleSettingsSectionHtml` 已迁 `views/settingsAggregation.mjs:moduleSettingsSectionHtml`）。
    - 投影拉不到时如实显示「拿不到工作台清单」，**不退回硬编码名单**；停用工作台后
      投影消失、页签/卡片/动作位跟着消失，重新启用即回来。
    - 判据：改页签行为时 `git diff public/app.js` 必须为零行增长；页签顺序只 diff manifest，
      视图行为只 diff `public/views/registry.mjs`；门禁 S2.12 钉死前端无第二份页签清单。

21. **命名单一真源（OS-148/G8a·G8d；OS-172 收口）：新增或改名一个概念，先改命名表再改代码。**
    - 表＝`public/views/registry.mjs` 的 `NAMING_TABLE`（概念 id ＋ 六列：`dir` 磁盘目录 /
      `tab` 页签名 / `panelLabel`「＋」面板名 / `logModule` changelog 模块名 /
      `contract` 契约域 / `mcpPrefix` MCP 工具名前缀；`libraryStorage` 另登记
      `metadataDir`/`projectSpec`/`carrierPrefix`/`wikiSchema`/`tempPrefix` 五个运行态与谱系字段，
      `dirTab`/`readonly`/`note` 只作行为与说明）。**全仓只有这一份数据**——后端经
      `src/protocol/naming.mjs` 只 re-export，不许再抄一份字面量。
    - 前端显示名、页签／入口名、库内目录名、日志模块名必须同名，一个概念只保留一个正名 slug。
      当前正名为 `世界书`、`故事源`、`扮演`、`导入导出`；`产物` 是页面名，不另设目录。
      历史别名只在 `libraryUpgrade.mjs` 作一次性迁移输入，不退回当前展示或双读。
    - 名字只从表里取：页签名在 manifest `pages[].label` 与表 `tab` 列逐字一致（S2.5）；
      写日志用 `LOG_MODULES.<概念>`；按目录推断日志用 `logModuleForDir()`；
      前端「视图→日志模块」用 `logModuleForView()`。`DIR_LABELS`/`DIR_ORDER`/
      `READONLY_DIRS`/`PAGE_TO_DIR_LOCAL` 同样由表逐键派生，不得退回手写字面量。
    - OS-172 已推翻 OS-48／OS-50 的目录名冻结与第二批 G8b 的 `参考/` 冻结。改名只改表的对应格，
      跨层跟着变；**MCP 工具名不在表里改名**（表只登记前缀供核对，改名会破坏外部调用方）。
      门禁：`test/naming.test.mjs` ＋ `node tools/acceptance/acceptance.mjs` 的 S2.5。

## 发布规范（推送前必读）

推 GitHub 前必过 [PUBLISHING.md](docs/PUBLISHING.md) 的检查单（协议干净/demo 干净/人机双读）；
自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`，全绿才推。

## 改完必跑（验收线，详见 `docs/ACCEPTANCE.md`）

```bash
node .zcode/run-gate.mjs                    # ① 全量单测（874 例）
node tools/acceptance/acceptance.mjs        # ② 交付标准 S0–S4 门禁（29 检查，Rea 式证据；S0=布局宪法）
# ③ .ua/ 知识图谱增量（/understand，skill 在 ~/.zcode/skills/understand*）
# ④ 前端批次给作者截图讲场景（对照 design-system/DESIGN.md + docs/UX-STRUCTURE.md）
```

①② 全绿才合入。CI 是合入门禁：本地先跑同样的三条命令——`npm test` 两轮、`node tools/acceptance/acceptance.mjs`、`npm run arch:check`；水浒／新建 e2e 仍是本地门禁。MCP 工具增删必须同步：`docs/mcp/*.md`、`test/mcp.test.mjs` 的工具数、
`DEMO.md`、`tools/acceptance/acceptance.mjs` 的 S1.1 覆盖面。

测试纪律（OS-169）：测试不许依赖本机环境——夹具一律临时 `LOCALAPPDATA`，不读真实用户目录、不靠本机
装了什么 CLI 或下载过什么模型；环境不齐就显式 skip 并注明守卫理由，禁止靠本机环境「假绿」。
门禁 S1.6 扫 `test/**`，出现本机绝对路径（允许清单为空）即红。

改了文件结构或行数之后跑 `npm run arch:stats` 回写文档，门禁会比对（`node tools/arch-stats.mjs --check` 只查不写）——
`ARCHITECTURE.md` 的分层数字只在生成段里，人不再手填。

## 仓内地图

- 启动入口：`src/host/daemon.mjs` / `src/host/mcp.mjs`（OS-159 直跑，仓根零垫片）
- 契约层：`src/api/contracts.mjs` 聚合器 ＋ `src/api/contracts/` 八域分片（library/chapters/fact/reference/
  agent/plugins/system/exchange，108 端点）→ `src/api/handlers/` 八域 handler ＋ `src/api/registry.mjs` 注册表（OS-141，键＝endpointId）
  → `src/host/daemon.mjs` 路由分派（endpointFor → validateRequest → 取 handler → 调用）＋ 共享管线 `src/host/{http,authorize,sse}.mjs`
- 自有物理内核：`src/kernel/index.mjs`（身份常量＋ok/fail/writeFileAtomic）＋ `identity.mjs`（`openstory-kernel@1`）；
  业务内核能力由 `src/protocol/capabilityImplementations.mjs` 统一注册，经 `src/host/capabilityBindings.mjs` 按库快照解析。
  `core/`、`vendor/` 已退役；逐文件出处见 `docs/kernel-provenance.md`，改名见 `docs/error-code-rename.md`
- 底座契约（`src/protocol/`，逐文件一句理由见 `src/protocol/README.md`）：hostWrite（宿主写协议唯一入口，OS-138）/
  changelog（变更日志）/ authorize（路径授权）/ modules＋capabilityGraph＋capabilityResolver（装载与能力图）/
  naming（命名取表口）/ libraryUpgrade（旧库一次性备份、迁移、退役留档与回滚）/ slots / agentEvents（进程内事件词表）
  ／与工作台无关的格式与路径纯函数；零转供叶、零实现复制
- 建库/导入自持（OS-123/124 fork 点）：`src/modules/storage/projectDoc.mjs`（`.openstory/project.json` 的
  `openstory-project@4` 合同＋建库骨架）／`src/protocol/{importAdapter,libraryTextUtil,worldbookContract}.mjs`
  （整目录导入＋章节号与世界书契约判定，OS-195 由 library/workbook 模块下沉）；
  `src/protocol/libraryUpgrade.mjs` 负责旧库一次性升级，不提供 Pinax 互认或清单导入
- `src/modules/deduce/`：`deduceEngine.mjs`（推演核封装，端子走模块内 `engine/index.mjs`）/
  `engine/`（OS-155 自上游平移到本模块的确定性推演链 8 件＋出口 index.mjs）；
  会话容器自 OS-195a 起归 `src/modules/deduce/deduceSession.mjs`（扮演/<bookId>/session.json），经 deduce 能力句柄取用
- `src/modules/worldbook/referenceStore.mjs`（世界书索引/图谱）· `src/modules/fact/enrich/engine.mjs`（语义富化 6 窗）· `src/modules/prose/factGuard.mjs`（OS-195b 归位）
- 底座服务（`src/services/`）：货架装载（skills/genres/stylePacks/suites/runtimes）＋ 跨内核底座服务（systemPrompt/
  syncCheck）＋ OS-193 遗留兼容叶；jobCenter/nativePicker/uiPreferences 已迁 `src/host/`
- `skills/` 创作知识库 31 包＋套件捆绑 2（SKILL.md 制）· `docs/mcp/` 对外分发材料 · `design-system/` 设计令牌包
- `tools/acceptance/` 验收门禁 · `.ua/` UA 知识图谱（intermediate/ 与 tmp/ 是运行产物不入库）
- `test/` node --test 全覆盖；跑法统一走 `.zcode/run-gate.mjs`（它会 chdir 到仓根）
- 遗留事项与「明确不做」清单：`docs/LEGACY-ITEMS.md`（OS-133 起收官判定的唯一台账）
