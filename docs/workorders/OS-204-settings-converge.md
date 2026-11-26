# OS-204 · 设置页收敛：两大域、单一装载

| 项 | 值 |
|---|---|
| 批次 | 第四批第 5 张；规划见 [`plugin-frontend-batch-20261126.md`](../plan/plugin-frontend-batch-20261126.md) §5 |
| 对应 | 规划书 §三-3「三处取数统一」、§三-5「旧分区收敛」、§四-4.4「三个概念各归其位」、§五 第 2、4 步；规划 §3 裁定 |
| 依赖 | OS-201～203 |
| 允许改动 | `src/api/contracts/system.mjs`、`src/api/handlers/system.mjs`、`src/host/daemon.mjs`（只为把 appVersion 传进 health 上下文；实现尽量放 handler）、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/number-anchors.json` |
| 风险 | 中——动设置页导航与套件货架的取数；`/api/health` 加一个字段 |
| 状态 | 待派（等 OS-203 验收） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

设置页左导航收敛成两大域七项，只在一处定义；左右栏面板的开关独立成「面板」一节；治理台、全部套件、本机模块三处只经一个装载函数取数、写进同一份状态；旧分区的深链仍可达；顺手把「关于」页写死的版本号换成真实版本。

## 现状（监督线 2026-11-26 实测）

- **导航定义在两处**：`public/app.js` 的 `SETTINGS_GROUPS`（本体设置三节＋插件中心两节「模块／全部套件」），以及 `public/views/settingsViews.mjs` 的 `settingsHtml()` 里追加的「本机模块」组；渲染时插件中心还会把六组货架的每个套件逐个铺成导航行。`SETTINGS_SECTIONS`（`app.js` 约 2951 行）没有任何调用方，是死码。
- **左右栏面板**（`WORKBENCH_MODULES`，8 个）的开关藏在每个套件详情的「工作台模块」小节里，没有独立入口；开合状态在库内 ui-state 的 `moduleHidden`。
- **取数三处三样**：治理台与本机模块读 `/api/plugins`；全部套件读 `/api/suites`（`loadSuites()`）。`app.js` 有 `loadSuites()` 与 `loadPlugins()` 两个装载函数。OS-200 起 `/api/plugins` 已经带货架记录，但前端还没改读。
- 旧分区 id 的重定向散在 `settingsHtml()` 的 `sectionRenderers` 里。
- 「关于」页版本号写死 `0.1.0`（`public/views/settingsViews.mjs:466`），而 `package.json` 是 `0.2.0`；`/api/health` 不回版本，前端也从不调它。

## 任务

### 1. 导航只在一处定义

`public/views/settingsViews.mjs` 里定义整张导航（具名导出纯数据与取表函数，供 Node 测试），`settingsHtml()` 只照它渲染：

| 组 | 项（id｜名称｜提示语） |
|---|---|
| 本体设置 | `appearance`｜外观｜皮肤主题与字号档位；`engines`｜引擎与存储｜Agent 运行时 / 模型 / 知识库 / 路径；`about`｜关于｜版本与定位 |
| 插件中心 | `governance`｜插件治理台｜能力图 · 启停 · 依赖 · 设置指路；`panels`｜面板｜左右栏面板插拔；`suites`｜全部套件｜技能包 / 文风包 / 体裁包 …；`localModules`｜本机模块｜模块根登记 · 预览 · 摘要 |

- `public/app.js` 删去 `SETTINGS_GROUPS` 与 `SETTINGS_SECTIONS`（不再注入 scope）。
- `settingsHtml()` 不再追加「本机模块」组，也**不再把套件逐个铺成导航行**（作者 2026-11-26 的原型裁定，取代 OS-101「插件中心逐套件铺行」的口径）；套件清单只在「全部套件」主面里按六组排，主从两栏照旧。
- 导航项的标签与提示上下两行，不许挤在同一行断字。

### 2. 面板独立成节

新节 `panels` 承载现有 8 个左右栏面板的开关：内容原样迁入（仍按左栏／右栏分组、仍写 ui-state `moduleHidden`、仍保留「当前库」那句提示）。套件详情（`public/views/suiteShelfViews.mjs`）不再嵌「工作台模块」小节——一个概念一个入口。

### 3. 单一装载

`loadPlugins()` 成为插件相关的唯一装载函数：把响应里的 `suites` 写进 `state.suites`，`suiteOverrides`／`suiteUserDir`／`suiteWarnings` 写进它们原来在的位置；删除 `loadSuites()` 与它的全部调用点，改调 `loadPlugins()`。`public/**` 里不许再出现对 `/api/suites` 的请求（端点本身保留不动）。套件启停与设置保存的写端点（`/api/suite/state`、`/api/suite/settings`）不动，写完 `loadPlugins()` 再 `render()`。

### 4. 旧分区重定向集中成一张表

`moduleSettings → governance`；`pluginsOverview`／`plugins`／`suite`／`suiteSettings`／`suiteDetail → suites`；`typography → appearance`；`models`／`kb`／`data`／`runtimes`／`runtime`／`discover → engines`。每个旧 id 都仍可达，重定向只写一处。

### 5. 「关于」页版本号

- `/api/health` 响应新增 `appVersion`：daemon 启动时读一次 `package.json` 的 `version`；契约 `healthGet.response` 加 `appVersion: 'string'`。其余字段不动。
- 前端进设置页时取一次 `/api/health` 回填，「关于」节显示真实版本；取不到写「未知」，不写死。

### 6. 帮助文案与文档

- `SETTINGS_HELP` 补 `governance`／`panels` 两条；删掉已无对应分区的条目。
- `docs/UX-STRUCTURE.md` 的设置页层级改成两大域七项；`AGENTS.md` 里「设置归一（OS-145/146）」那一段与第 20 条补上治理台与单一装载；`docs/UI-KIT.md` §7.5 登记 `.gov-*` 专用组件前缀。

## 测试（新建 `test/settingsNav.test.mjs`）

- **导航**：恰为两组七项，组的顺序、项的顺序与 id 与任务 1 一致；`settingsHtml()` 输出的导航里没有逐套件的行；「本机模块」在插件中心组里。
- **重定向**：旧 id 逐个渲染出对应分区的内容。
- **面板**：`panels` 节列出 8 个面板并按左栏／右栏分组；套件详情里不再有「工作台模块」小节；开关仍是 `module-toggle`，写 `moduleHidden`。
- **单一装载**：`public/app.js` 与 `public/views/*.mjs` 里没有 `/api/suites`、没有 `loadSuites`；`loadPlugins` 把 `suites` 写进 `state.suites`。
- **版本**：`healthGet` 契约有 `appVersion`；daemon 返回的 `appVersion` 等于 `package.json` 的 `version`；「关于」节显示它，取不到显示「未知」。
- `app.js` 行数不增。
- 既有红线全绿：`test/shellViewsC6.test.mjs`、`test/governanceViews.test.mjs`、`test/suites.test.mjs`、`test/runtimeShelf.test.mjs`、`test/daemonSingleInstance.test.mjs`、`test/pluginGovernanceProjection.test.mjs`、`test/moduleSettingsConsumers.test.mjs`。

## 既有测试的合法改写（逐处说明，断言不弱于原来）

- `test/shellViewsC6.test.mjs`：夹具里 `SETTINGS_GROUPS: []` 这个入参随 scope 变化删除；其余断言照旧或加强。
- 其它文件里若引用了 `loadSuites`／`SETTINGS_GROUPS`／「工作台模块」小节，一并改指新实现并在回报里列出（监督线扫过，目前只有 `shellViewsC6`）。

## 不做

- 不动 `GET /api/suites` 端点与 `/api/suite/*` 写端点；不改 MCP 工具名。
- 显示名迁入投影（OS-205）。

## 验收

- 机器门禁全绿；`app.js` 行数不增；端点数仍为 108；`git diff --check` 干净。
- 生产调用点贴出来（`文件:行`）：导航定义与渲染、重定向表、`loadPlugins` 的货架写位、`appVersion` 的来源与显示。
- 反证一则：在 `public/app.js` 里临时加回一句对 `/api/suites` 的请求，对应用例必须红；贴输出后还原。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 900 · pass 898 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `public/views/settingsViews.mjs` — 新增导航真源 `SETTINGS_NAV`／重定向表 `SETTINGS_REDIRECT`／取表函数 `settingsNavLabel`；`settingsHtml()` 只照表渲染（去掉逐套件铺行与追加组）；面板节承载 8 个开关；关于页版本取 `state.appVersion`；SETTINGS_HELP 按七项重整
- `public/app.js` — 删 `SETTINGS_GROUPS`／`SETTINGS_SECTIONS`／`settingsModulesSectionHtml` 壳／`loadSuites` 及全部调用；`loadPlugins()` 写货架四键；进设置页取 `/api/health` 回填版本（10095→10044 行）
- `public/views/suiteShelfViews.mjs` — 套件详情移除「工作台模块」小节
- `src/api/contracts/system.mjs` — `healthGet.response` 加 `appVersion: 'string'`
- `src/api/handlers/system.mjs` — health 回包带 `appVersion`
- `src/host/daemon.mjs` — 启动时读一次 package.json version，注入 health 上下文
- `test/settingsNav.test.mjs`（新建）— 导航/重定向/面板/单一装载/版本/行数守卫
- `test/shellViewsC6.test.mjs`、`test/governanceViews.test.mjs`、`test/degradedSurfaces.test.mjs` — 按合法改写删去 `SETTINGS_GROUPS` 入参，其余断言保留
- `docs/UX-STRUCTURE.md`、`AGENTS.md`、`docs/UI-KIT.md`、`README.md`、`ARCHITECTURE.md`、`docs/number-anchors.json` — 文档与数字锚回写

VERIFIED:
- `npm test`：900 例 / 898 pass / 2 skip / 0 fail
- `node tools/acceptance/acceptance.mjs`：29 过 / 0 挂 / 0 警
- `node tools/arch-stats.mjs --check`、`node tools/number-anchors.mjs --check`（900 例／端点 108／app.js 10044≤10500）、`git diff --check`：均 OK
- 反证：临时在 `public/app.js` 加回 `await api('/api/suites')` → `node --test test/settingsNav.test.mjs` 报 `AssertionError: app.js 不再请求套件端点`（`test/settingsNav.test.mjs:141`），7 例中 1 挂；随后还原并复跑 7/7 绿
- 生产调用点：导航定义 `public/views/settingsViews.mjs:8`、渲染 `:747`、重定向表 `:29`／`:742`；单一装载写位 `public/app.js:3482`、health 取数 `:8087`；`appVersion` 来源 `src/host/daemon.mjs:86`／`:609` → `src/api/handlers/system.mjs:54` → 显示 `public/views/settingsViews.mjs:549`；面板开关写回 `public/app.js:9164`→`:4487`

LIMITATIONS: 无
```
