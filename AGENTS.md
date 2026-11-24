# AGENTS.md — OpenStory

> 给所有在本仓干活的 agent（Zcode / Qoder / Codex / Claude / CodeBuddy…）的入仓须知。
> 人在环：作者本人裁定一切；拿不准就问，别自作主张动稿。

## 这里是什么

零 npm 构建依赖的中文小说工作台：入口 `src/host/daemon.mjs`（实现文件直跑，OS-159 起仓根零垫片）：
node:http 手写路由，127.0.0.1:8807；
OS-127 进程治理：单实例锁＋stamp＋generation＋`/api/health`）
+ `public/` 原生 JS 前端。模块：**小说**（纯净写作面）/ **世界书**（参考笔记＋拆解词条只读层）/
**习惯**（写作规矩表）/ **故事源**（fact 链可视化）/ **扮演**（主持人＋多角色，默认）/ **确定性推演**（可选）/ **剧本** / **分析**（本地引擎）。
全部经契约层（`src/api/contracts.mjs` 聚合 `src/api/contracts/` 七域分片，101 端点）分派；
MCP 对外 24 工具（`src/host/mcp.mjs` 直跑；stdio 独立进程，数据操作走 daemon HTTP 薄适配）。
分层见 [ARCHITECTURE.md](./ARCHITECTURE.md)（L7 前端→L6 契约→L5 daemon→
L4 自持层→L2 自有内核 `src/kernel/`→L1 磁盘库；OS-157 起 L2/L3 合并）。

## 硬规则（违反＝白干）

1. **内核自有、磁盘格式名冻结**：内核身份 `openstory-kernel@1`，实现只在 `src/kernel/**`
   （公开面 `index.mjs` 五键 factStore/enrich/ok/fail/writeFileAtomic；身份 `identity.mjs`）；
   由 Pinax-next `feat/pinax-electron-next`@`70a4f44` 于 OS-152→157 逐步转自有，@pinax/core
   0.16.0 的世界书契约转为 `src/modules/worldbook/worldbookFileContract.mjs`，
   逐文件「来源 → 现位置」见 `docs/kernel-provenance.md`。`core/`、`vendor/` 与
   `npm run vendor:check` 已整体退役（OS-157）；门禁 S2.4' 钉死 `src/**` 与仓根两个垫片
   不得出现 `core/` 路径说明符。磁盘格式名冻结：`.pinax/project.json`＝`pinax-project@3`、
   `拆解/*.json`＝`fact.data/v3`、`*.wiki.json`＝`pinax-wiki-derived@1`、
   `.pinax-tmp-*` 临时前缀——变更须连金样与互认夹具一起评估。写协议只经
   `factFileStore.writeFactFile`，宿主写通道只经 `src/protocol/hostWrite.mjs`；模块不直引
   内核，只经协议层（`src/protocol/index.mjs` 的 `fact` 命名空间与 `factDomain.mjs` 等转供叶）。
   推演 8 件（opening/turn/settle/candidates/fronts/patchChannel/sceneContext/sessionState）
   归 `src/modules/deduce/engine/`——它是产品引擎，不是内核；Host API `host-api@2` 五键定稿。
2. **daemon 只监听 127.0.0.1**；凭据只存本机（agent-config.json），响应只回掩码。
3. **参考单向性**：正文不反向进参考上下文；参考不能全量丢进 Agent 上下文。
4. **absorb 不开 MCP**：旧目录迁入参考是显式动稿操作，只走界面按钮。
5. **MCP 不开 agent 对话**（不套娃）；写操作一律有 .history 备份。
6. **模块不耦合**：功能模块间禁止直接 import——只经协议层（`src/api/contracts.mjs`/`src/protocol/chapters.mjs`/
   `src/protocol/changelog.mjs`/`src/protocol/versionGate.mjs`/`src/protocol/plugins.mjs`/`src/kernel/index.mjs`，门禁 S2.1 白名单）；
   依赖注入解（范例见 `src/modules/kb/kbHealth.mjs` 的 resolveCollections 注入）。
   建库/导入/章节号解析已**本仓自持**（`src/modules/library/projectDoc.mjs`/`importAdapter.mjs`/`textUtil.mjs`，
   OS-123/124 fork 点），不再复用上游内核。
   > **模块插件（OS-144）**：工作面升格为 `src/modules/<id>/module.manifest.json`（`openstory-module@1`：
   `id/name/version/core:false/endpoints/pages/settings`）。`endpoints` 只登**独占**端点——共用端点
   （如 fact 读）不登记，停用任何模块都不许让它失效。启停判定与端点归属只有单一入口
   `src/protocol/modules.mjs`（`isModuleEnabled` / `isModuleDisabledFor`），状态落库内 ui-state
   `modules.enabled.<id>`（缺省 true，值不删）。两层插拔各存各键、互不覆盖：右栏分析卡片级
   `analyzeEnabled`（旧）vs 整模块级 `modules.enabled.<id>`（本层）。新增 module manifest 必须过
   `test/modulePlugins.test.mjs` 的形状校验。
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
7. **布局宪法（OS-140）**：仓根只允许「入口、包描述、文档」——`.mjs` 只有 `daemon.mjs`/`mcp.mjs`
   两个**入口垫片**（`export * from` 实现文件再出口全部符号；只有被 node 直接执行才调
   `main(argv)`，纯 import 不得启动服务）。自持模块全部收进 `src/` 六目录，新模块一律入对应子目录：

   | 目录 | 内容 |
   |---|---|
   | `src/host/` | daemon/mcp 实现（组合根：路由、进程治理、路径解析） |
   | `src/api/` | 契约层 `contracts.mjs` ＋ `contracts/` 七域分片（API 形状唯一真源） |
   | `src/protocol/` | 文件与协议层：chapters/chapterNumber/changelog/versionGate/plugins/agentEvents/factGuard/dependencyGraph/hostWrite/libState |
   | `src/kernel/` | 自有内核（`openstory-kernel@1`）：公开面 `index.mjs`＋身份 `identity.mjs`，管道件 `errors.mjs`/`atomicWrite.mjs`/`fsDurability.mjs`，`fact/{factFileStore,wikiDerive,factPack,domain/}`，`enrich/`；core/、vendor/ 已退役 |
   | `src/modules/` | 域模块：library/（建库导入）、deduce/（推演）、roleplay/（扮演）、worldbook/（参考）、agentbar/（Agent 存储）、analysis/comfyui/kb（模块插件，各带 `module.manifest.json`） |
   | `src/services/` | 外围服务：embedding-server/embeddingPaths、cli-bridge/dsh-*/runtimes（模型驱动）、stylePacks/style-check/suites/skills/genres（货架）、jobCenter/nativePicker/syncCheck/enrichEngine |

   实现文件不得再放仓根；垫片不得长业务逻辑。门禁 S0.1 钉死仓根恰好两个 `.mjs`。
8. **前端令牌单一真源**：颜色进 `public/index.html` 的 `:root`（同步 `design-system/tokens.css`）；
   样式令牌区外禁止裸色值。侧栏=绝对定位浮层，正文恒居中（OS-48 宪法）。
   组件约定见 `docs/UX-STRUCTURE.md`。

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

10. **落盘位置固定，不得散落。** 全部在库根内的固定位置：
   | 数据 | 位置 |
   |---|---|
   | 正文/剧本/参考/世界书等稿件 | `<库>/<业务目录>/*.md` |
   | 未保存的编辑草稿（作者正在写、还没提交） | `<库>/.pinax/drafts/<模块>/<id>.json` |
   | 推演中未被采纳的拍/会话 | `<库>/.openstory/deduce/<bookId>.json` |
   | 推演/ 容器（扮演页的会话／归档／导出／素材） | `<库>/推演/<bookId>/session.json`（主线）＋`sessions/<sid>.json`（多局）＋`active.json`（激活指针）／`归档/第N章.md`／`导出/会话-<bookId>-<sid>-<ts>.md`／`素材/{角色,场景,bgm}/*`；引擎态另在 `<库>/.openstory/deduce/<bookId>.json`（多局 `<bookId>@<sid>.json`） |
   | 界面状态（页签、模块开关、选中项） | `<库>/.pinax/ui-state.json` |
   | 套件（业务插件）启停与设置值 | `<库>/.openstory/plugins/suite-state.json`（OS-160 起随库走；机器级同名文件降为「没开库时的缺省」，旧库不迁移） |
   | 每一版修改的 diff 与日志 | `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl` |
   | 旧版原文备份（二进制快照） | 同目录 `.history/<file>.bak-<stamp>`（现有机制，保留；OS-137 起滚动保留：每文件配额 50 份＋日锚，绝不删最新，删除留痕 `.pinax/log/history-prune/`） |
   | 本机凭据/模型端点 | `%LOCALAPPDATA%/OpenStory/openstory/agent-config.json`（含密钥，不入库） |
   | 机器级界面偏好（皮肤，无库也生效） | `%LOCALAPPDATA%/OpenStory/openstory/ui-preferences.json`（OS-158，不入库；任何端口共用一份） |
   | 旧院（冻结，OpenStory 不读不写不删） | `%LOCALAPPDATA%/PinaxNext/`（OS-166 起只作为 Pinax 桌面端的院；首启一次性**拷贝**到新院并留 `.migrated-from-pinaxnext.json` 标记，绝不迁移/删除旧院） |
   | 本机库清单（root 白名单来源） | `%LOCALAPPDATA%/OpenStory/libraries.json`（OS-167：`{schemaVersion,libraries:[{path,name,addedAt,source}]}`；`source=openstory\|imported-pinax`。旧 Pinax 清单只读导入，不写回；互认靠库内 `.pinax/project.json`，不靠本机清单） |

11. **每一次修改都必须有 diff + log，且可被模块自检索。**
    - 写操作一律经 `src/protocol/changelog.mjs` 的 `recordChange()`：自动算 unified diff、
      写 `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl`（append-only，一行一记录）。
    - 每个模块**加载时**必须调 `GET /api/log?root=&module=` 取自己的近期日志，
      在界面上如实呈现（作者要能看见「这个模块最近改了什么」）。
    - 记录必须含：`at / module / file / op / actor / beforeHash / afterHash / diff / bytes`。
      绝不记录密钥、正文全文以外的隐私内容。

12. **推演/草稿等「未确认」内容同样必须落本地。**
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
    - 存在库内 `.pinax/ui-state.json` 的 `typography` 键（`{ui, doc}`）。
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

20. **app.js 增量冻结（OS-143，作者立宪：活装配壳只减不增）。**
    `public/app.js` 是消费壳，页签/路由唯一真源在 `public/views/registry.mjs`
    （TAB_REGISTRY 声明式注册表：新增页签＝给注册表加一条纯数据，app.js 一行不动；
    行为语义见 `test/tabRegistry.test.mjs` 的旧算法对拍）。自此：
    - **app.js 只许减不许增**（修 bug 除外）；视图渲染函数本体**只出不进**——
      迁出（G5 起逐个搬去模块）时在 `VIEW_RENDERERS` 插座改注册名，注册表只存名字、
      绝不 import app.js（依赖方向恒为壳→表，门禁 S2.2 扫描面已含 views/registry.mjs）。
    - **OS-146 补钉**：app.js 只留**接线**（取数 → 转交，必要时一行占位）；
      **视图渲染函数一律在 `public/views/`**，写在 app.js 里算违约（判例：
      `settingsModuleSettingsSectionHtml` 已迁 `views/settingsAggregation.mjs:moduleSettingsSectionHtml`）。
    - 页签词表/退场表/体裁裁剪/作用域校验不准改回 app.js 内联；
      词表外目录不出页签（OS-92）、退场目录无条件过滤（OS-84/86）的改动只能发生在注册表。
    - 判据：改页签行为时 `git diff public/app.js` 必须为零行增长；扩展页签只 diff
      `public/views/registry.mjs`。

21. **命名单一真源（OS-148/G8a·G8d）：新增或改名一个概念，先改命名表再改代码。**
    - 表＝`public/views/registry.mjs` 的 `NAMING_TABLE`（概念 id ＋ 六列：`dir` 磁盘目录 /
      `tab` 页签名 / `panelLabel`「＋」面板名 / `logModule` changelog 模块名 /
      `contract` 契约域 / `mcpPrefix` MCP 工具名前缀；另有三列实况补注 `dirLabel`/
      `dirLogModule`/`dirTab`）。**全仓只有这一份数据**——后端经
      `src/protocol/naming.mjs` 只 re-export，不许再抄一份字面量。
    - 五层的名字只从表里取：页签条目的 `dir`/`label`/`panelLabel` 由 `tabNaming(概念id)` 派生；
      写日志用 `LOG_MODULES.<概念>`；按目录推断日志用 `logModuleForDir()`；
      前端「视图→日志模块」用 `logModuleForView()`。`DIR_LABELS`/`DIR_ORDER`/
      `READONLY_DIRS`/`PAGE_TO_DIR_LOCAL` 同样由表逐键派生，不得退回手写字面量。
    - 改名只改表的对应格，跨层跟着变；**MCP 工具名不在表里改名**（表只登记前缀供核对，
      改名会破坏外部调用方）。门禁：`test/naming.test.mjs` ＋ `node tools/acceptance/acceptance.mjs`
      的 S2.5。

## 发布规范（推送前必读）

推 GitHub 前必过 [PUBLISHING.md](docs/PUBLISHING.md) 的检查单（协议干净/demo 干净/人机双读）；
自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`，全绿才推。

## 改完必跑（验收线，详见 `docs/ACCEPTANCE.md`）

```bash
node .zcode/run-gate.mjs                    # ① 全量单测（547 例）
node tools/acceptance/acceptance.mjs        # ② 交付标准 S0–S4 门禁（19 检查，Rea 式证据；S0=布局宪法）
# ③ .ua/ 知识图谱增量（/understand，skill 在 ~/.zcode/skills/understand*）
# ④ 前端批次给作者截图讲场景（对照 design-system/DESIGN.md + docs/UX-STRUCTURE.md）
```

①② 全绿才合入。MCP 工具增删必须同步：`docs/mcp/*.md`、`test/mcp.test.mjs` 的工具数、
`DEMO.md`、`tools/acceptance/acceptance.mjs` 的 S1.1 覆盖面。

改了文件结构或行数之后跑 `npm run arch:stats` 回写文档，门禁会比对（`node tools/arch-stats.mjs --check` 只查不写）——
`ARCHITECTURE.md` 的分层数字只在生成段里，人不再手填。

## 仓内地图

- 启动入口：`src/host/daemon.mjs` / `src/host/mcp.mjs`（OS-159 直跑，仓根零垫片）
- 契约层：`src/api/contracts.mjs` 聚合器 ＋ `src/api/contracts/` 七域分片（library/chapters/fact/reference/
  agent/plugins/system，101 端点）→ `src/api/handlers/` 七域 handler ＋ `src/api/registry.mjs` 注册表（OS-141，键＝endpointId）
  → `src/host/daemon.mjs` 路由分派（endpointFor → validateRequest → 取 handler → 调用）＋ 共享管线 `src/host/{http,authorize,sse}.mjs`
- 自有内核：`src/kernel/index.mjs`（公开面五键）＋ `identity.mjs`（`openstory-kernel@1`）→
  `fact/{factFileStore,wikiDerive,factPack,domain/}`（fact 链＋写协议）＋ `enrich/`（只读度量）＋
  管道件 `errors.mjs`／`atomicWrite.mjs`／`fsDurability.mjs`；推演链 OS-155 起归
  `src/modules/deduce/engine/`，世界书契约归 `src/modules/worldbook/worldbookFileContract.mjs`。
  `core/`、`vendor/` 已退役；逐文件出处见 `docs/kernel-provenance.md`，改名见 `docs/error-code-rename.md`
- 协议层（`src/protocol/`）：chapters（章节协议）/ chapterNumber（章节号解析）/ changelog（变更日志）/ versionGate（版本闸）/
  plugins（插件聚合）/ agentEvents（AG-UI 事件）/ factGuard（事实守护）/ hostWrite（宿主写协议唯一入口，OS-138）/ libState（库内状态）
- 建库/导入自持（OS-123/124 fork 点，`src/modules/library/`）：`projectDoc.mjs`（project.json 合同＋建库骨架，
  `.pinax/project.json` 格式是与 Pinax 桌面端的双向兼容契约）/ `importAdapter.mjs`（整目录导入）/
  `textUtil.mjs`（章节号＋世界书契约判定）
- `src/modules/deduce/`：`deduceEngine.mjs`（推演核封装，端子走模块内 `engine/index.mjs`）/
  `engine/`（OS-155 自上游平移到本模块的确定性推演链 8 件＋出口 index.mjs）/
  `deduceSession.mjs`（会话容器，推演/<bookId>/session.json）
- `src/modules/worldbook/referenceStore.mjs`（参考索引/图谱）· `src/services/enrichEngine.mjs`（语义富化 6 窗）· `src/protocol/factGuard.mjs`
- 外围服务（`src/services/`）：kb*（知识库三件套）＋ embedding-server ＋ cli-bridge/dsh-cli/dsh-bridge/runtimes（模型驱动）
  ＋ stylePacks/style-check/suites/skills/genres（货架）＋ jobCenter/nativePicker/comfyEngine/syncCheck
- `skills/` 创作知识库 31 包＋套件捆绑 2（SKILL.md 制）· `docs/mcp/` 对外分发材料 · `design-system/` 设计令牌包
- `tools/acceptance/` 验收门禁 · `.ua/` UA 知识图谱（intermediate/ 与 tmp/ 是运行产物不入库）
- `test/` node --test 全覆盖；跑法统一走 `.zcode/run-gate.mjs`（它会 chdir 到仓根）
- 遗留事项与「明确不做」清单：`docs/LEGACY-ITEMS.md`（OS-133 起收官判定的唯一台账）
