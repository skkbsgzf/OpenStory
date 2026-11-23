# AGENTS.md — OpenStory

> 给所有在本仓干活的 agent（Zcode / Qoder / Codex / Claude / CodeBuddy…）的入仓须知。
> 人在环：作者本人裁定一切；拿不准就问，别自作主张动稿。

## 这里是什么

零 npm 构建依赖的中文小说工作台：`daemon.mjs`（node:http 手写路由，127.0.0.1:8807；
OS-127 进程治理：单实例锁＋stamp＋generation＋`/api/health`）
+ `public/` 原生 JS 前端。模块：**小说**（纯净写作面）/ **世界书**（参考笔记＋拆解词条只读层）/
**习惯**（写作规矩表）/ **故事源**（fact 链可视化）/ **扮演**（主持人＋多角色，默认）/ **确定性推演**（可选）/ **剧本** / **分析**（本地引擎）。
全部经契约层（`contracts.mjs` 聚合 `contracts/` 七域分片，101 端点）分派；
MCP 对外 24 工具（`mcp.mjs`，stdio 独立进程，数据操作走 daemon HTTP 薄适配）。
七层实测分层见 [ARCHITECTURE.md](./ARCHITECTURE.md)（L7 前端→L6 契约→L5 daemon→
L4 自持层→L3 pinaxAdapter→L2 core/pinax 24 文件→L1 磁盘库）。

## 硬规则（违反＝白干）

1. **内核 vendor 禁改**：`core/pinax/**`（24 文件 fact 链，逐字 vendor 自 Pinax-next@70a4f44）
   与 `vendor/contracts/**`（OS-132 收编自 @pinax/core 0.16.0）内容一个字节不许动（见
   `core/VENDORED.md`）。改动发生在上游再同步；漂移检测：`npm run vendor:check`
   （sha256 指纹锚 `core/.vendored-manifest.json`）。**仓根模块只有 `pinaxAdapter.mjs`
   可以 import `core/**`**（门禁 S2.4 钉死）——内核能力一律走它的五组出口
   （factStore/deduce/enrich/projectMeta/projectImport）。
2. **daemon 只监听 127.0.0.1**；凭据只存本机（agent-config.json），响应只回掩码。
3. **参考单向性**：正文不反向进参考上下文；参考不能全量丢进 Agent 上下文。
4. **absorb 不开 MCP**：旧目录迁入参考是显式动稿操作，只走界面按钮。
5. **MCP 不开 agent 对话**（不套娃）；写操作一律有 .history 备份。
6. **模块不耦合**：功能模块间禁止直接 import——只经协议层（`contracts.mjs`/`chapters.mjs`/
   `changelog.mjs`/`versionGate.mjs`/`plugins.mjs`/`pinaxAdapter.mjs`，门禁 S2.1 白名单）；
   依赖注入解（范例见 `kbHealth.mjs` 的 resolveCollections 注入）。
   建库/导入/章节号解析已**本仓自持**（`projectDoc.mjs`/`importAdapter.mjs`/`textUtil.mjs`，
   OS-123/124 fork 点），不再复用上游内核。
7. **前端令牌单一真源**：颜色进 `public/index.html` 的 `:root`（同步 `design-system/tokens.css`）；
   样式令牌区外禁止裸色值。侧栏=绝对定位浮层，正文恒居中（OS-48 宪法）。
   组件约定见 `docs/UX-STRUCTURE.md`。

## 本地化与可追溯（OS-89 作者立宪，不可协商）

作者口径原文：「所有的内容必须放在本地。对于已经落盘的内容，应该放在固定的落盘位置。
对那些还没有落盘的数据，比如用户还没有保存，或者像推演这种——处于推演阶段有一个文档，
但没有被用户真实认可并保存到正文里——这些都是要落到本地的，绝对不能放在任何浏览器缓存里。
所有的保存行为和储存行为都是基于本地的本地文件。所有的修改都要有 diff，都要有 log。
每一个模块在每次加载的时候，都要自己检索一遍跟自己相关的一些 log。」

8. **一切状态落本地文件，浏览器只做内存视图。**
   - 禁止用 `localStorage` / `sessionStorage` / IndexedDB 保存任何**内容性或状态性**数据
     （草稿、偏好、选中项、会话指针、模块开关…）。
   - 允许的唯一例外：皮肤/字号这类**纯渲染偏好**也只在无库可写时兜底；有库时必须落库。
   - 判据：**关掉浏览器、换一台机器、清缓存后，重新打开库必须完全复原。** 不能复原＝违规。

9. **落盘位置固定，不得散落。** 全部在库根内的固定位置：
   | 数据 | 位置 |
   |---|---|
   | 正文/剧本/参考/世界书等稿件 | `<库>/<业务目录>/*.md` |
   | 未保存的编辑草稿（作者正在写、还没提交） | `<库>/.pinax/drafts/<模块>/<id>.json` |
   | 推演中未被采纳的拍/会话 | `<库>/.openstory/deduce/<bookId>.json` |
   | 界面状态（页签、模块开关、选中项） | `<库>/.pinax/ui-state.json` |
   | 每一版修改的 diff 与日志 | `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl` |
   | 旧版原文备份（二进制快照） | 同目录 `.history/<file>.bak-<stamp>`（现有机制，保留） |
   | 本机凭据/模型端点 | `%LOCALAPPDATA%/PinaxNext/openstory/agent-config.json`（含密钥，不入库） |

10. **每一次修改都必须有 diff + log，且可被模块自检索。**
    - 写操作一律经 `changelog.mjs` 的 `recordChange()`：自动算 unified diff、
      写 `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl`（append-only，一行一记录）。
    - 每个模块**加载时**必须调 `GET /api/log?root=&module=` 取自己的近期日志，
      在界面上如实呈现（作者要能看见「这个模块最近改了什么」）。
    - 记录必须含：`at / module / file / op / actor / beforeHash / afterHash / diff / bytes`。
      绝不记录密钥、正文全文以外的隐私内容。

11. **推演/草稿等「未确认」内容同样必须落本地。**
    推演拍、Agent 待确认卡、未保存草稿都属于「已产生但未采纳」的数据，
    必须落在上表位置，禁止只活在浏览器内存或缓存里。采纳后才写进正文，但**产生时就要落盘**。

## 前端开发协议（OS-91 作者立宪，写任何 UI 前必读）

作者口径原文：「前端的 CSS 需要全局化，在全局设置中配置应用，明确规范好有几个大小档位，
正文模块和功能模块的字体大小档位区分开……交给项目级设置去做全局的主题设置，强制覆盖各个页签。
同时，项目级的约束里，加强前端开发的描述约束、协议等。」

12. **字号只准用令牌，禁止裸写 px。** 全站两条独立轨道：

    | 轨道 | 令牌 | 用于 | 档位 |
    |---|---|---|---|
    | **功能轨** | `--ui-fs-2xs / xs / sm / md / base / lg / xl / 2xl` | 按钮/表单/卡片/标签/表格/导航 | 紧凑·标准·大·特大（`--ui-scale` 0.92/1/1.08/1.18） |
    | **正文轨** | `--doc-font-size` + `--doc-line-height` | 纸面正文（阅读/写作） | 小·中·大·特大·巨（15/17/19/21/24px） |

    - 功能模块里**不要出现** `--doc-*`；正文纸面里**不要出现** `--ui-fs-*`。
    - 行高用 `--ui-lh-tight|normal|loose`；控件高度用 `--ui-ctl-h`；内边距用 `--ui-ctl-px` / `--ui-row-py`。
    - 新页面照抄 `habits-form`（OS-91 治理后的样板）：标签 `--ui-fs-sm`、控件 `--ui-fs-md`、
      辅助说明 `--ui-fs-xs`、间距 `calc(Npx * var(--ui-scale))`。

13. **档位是项目级的，由「设置 · 主题与字号」统一控制，强制覆盖所有页签。**
    - 存在库内 `.pinax/ui-state.json` 的 `typography` 键（`{ui, doc}`）。
    - 任何页签**不得**自行覆盖字号——页面只管用令牌，缩放交给项目设置。
    - 违反判例：习惯页曾把字号写死成 12/12.5/13px 三档混用，作者实测「表格框线、字体和大小都不对」。

14. **控件视觉必须统一。** 输入类控件一律：
    `border: 1px solid var(--line)` + `border-radius: var(--radius)` +
    `padding: var(--ui-row-py) var(--ui-ctl-px)` + `font-size: var(--ui-fs-md)`；
    聚焦态 `border-color: var(--accent)`，不用 outline。
    卡片面用 `--surface-card`，影用 `--shadow-card`（浮起才用 `--shadow-float`）。

15. **新增 UI 元素前先问：全局已有同款吗？** 有就用令牌，没有就先在 `:root` 加语义令牌
    （进 `design-system/tokens.css` 同步），再在页面里用——禁止在页面样式里发明一次性数值。

16. **新 UI 只用 `.uikit-*` 与令牌；老类只是兼容别名。** 完整组件清单、用法示例、
    交互契约与自检清单见 **[docs/UI-KIT.md](./docs/UI-KIT.md)** ——写前端前先读它。
    - 组件在 `public/ui-kit.mjs`（10 个：chipField/field/textInput/select/toolbar/
      card/emptyState/kvTable/buttonGroup/chipChip）
    - 老类（`.btn-primary`/`.btn-ghost`/`.icon-btn`/`.select`/`.file-input`/`.text`/
      `.kv-line`）已重写为与 uikit 同源的令牌组合，**不再新增变体**
    - 多值输入用 `chipField`（标签式），**不要**再用「一行一个」的 textarea

17. **间距也只准用令牌。** `--ui-gap-3xs|2xs|xs|sm|md|lg|xl|2xl`（全部跟 `--ui-scale`
    缩放）；页面级栅格允许 `calc(Npx * var(--ui-scale))`。
    专用可视化组件（`.ss-*` / `.ded-*` / `.ct-*` 等）**可以有自己的类名前缀，
    但字号/颜色/间距必须走全局令牌**——不允许另建一套像素体系。
    详见 [docs/UI-KIT.md](./docs/UI-KIT.md) 第 7 节。

18. **窄面板 / 嵌入适配有硬下限（OS-114，作者口径：「前端适配要加一些约束」）。**
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

## 发布规范（推送前必读）

推 GitHub 前必过 [PUBLISHING.md](./PUBLISHING.md) 的检查单（协议干净/demo 干净/人机双读）；
自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`，全绿才推。

## 改完必跑（验收线，详见 `docs/ACCEPTANCE.md`）

```bash
node .zcode/run-gate.mjs                    # ① 全量单测（446 例）
node tools/acceptance/acceptance.mjs        # ② 交付标准 S1–S4 门禁（15 检查，Rea 式证据）
# ③ .ua/ 知识图谱增量（/understand，skill 在 ~/.zcode/skills/understand*）
# ④ 前端批次给作者截图讲场景（对照 design-system/DESIGN.md + docs/UX-STRUCTURE.md）
```

①② 全绿才合入。MCP 工具增删必须同步：`mcp/skills/*.md`、`test/mcp.test.mjs` 的工具数、
`DEMO.md`、`tools/acceptance/acceptance.mjs` 的 S1.1 覆盖面。

## 仓内地图

- 契约层：`contracts.mjs` 聚合器 ＋ `contracts/` 七域分片（library/chapters/fact/reference/
  agent/plugins/system，101 端点）→ `daemon.mjs` 路由实现（endpointFor 分派 + validateResponse 校验）
- 内核进口：`pinaxAdapter.mjs`（唯一进口，五组能力出口）→ `core/pinax/` 24 文件 fact 链
  （存储协议 factFileStore ／推演端子 deduce ／enrich 度量）＋ `vendor/contracts/worldbookFileContract.js`；
  出处与漂移见 `core/VENDORED.md` ＋ `npm run vendor:check`
- 建库/导入自持（OS-123/124 fork 点）：`projectDoc.mjs`（project.json 合同＋建库骨架，
  `.pinax/project.json` 格式是与 Pinax 桌面端的双向兼容契约）/ `importAdapter.mjs`（整目录导入）/
  `textUtil.mjs`（章节号＋世界书契约判定）
- `deduceEngine.mjs`（推演核封装，端子走 pinaxAdapter）/ `deduceSession.mjs`（会话容器，推演/<bookId>/session.json）
- `referenceStore.mjs`（参考索引/图谱）· `enrichEngine.mjs`（语义富化 6 窗）· `factGuard.mjs`
- `skills/` 创作知识库 31 包＋套件捆绑 2（SKILL.md 制）· `mcp/skills/` 对外分发材料 · `design-system/` 设计令牌包
- `tools/acceptance/` 验收门禁 · `.ua/` UA 知识图谱（intermediate/ 与 tmp/ 是运行产物不入库）
- `test/` node --test 全覆盖；跑法统一走 `.zcode/run-gate.mjs`（它会 chdir 到仓根）
- 遗留事项与「明确不做」清单：`docs/LEGACY-ITEMS.md`（OS-133 起收官判定的唯一台账）
