# OS-201a · 治理台卡片流返工：只管 21 件模块、货架不伪装成工作台

| 项 | 值 |
|---|---|
| 批次 | 第四批（段内返工）；主单 [OS-201](OS-201-governance-cards.md) |
| 依赖 | OS-201（`527d0b6`）、OS-200（`0cfc25c`） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中——只改投影到卡片的取数与一处渲染条件；不新增端点、不动后端 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 为什么返工（监督线 2026-11-26 实测，克隆 `527d0b6`）

`/api/plugins.modules[]` 自 OS-192 起含 **69 条**：21 件模块（7 kernel＋12 workbench＋2 宿主组合面）＋ 48 件货架（`class: 'suite'`：技能包、文风包、体裁包、运行时套件、业务套装、推演规则包）。OS-201 的 `governanceModel` 把 69 条全部当卡片：

- **工作台组 60 张**（12 件工作台＋48 件货架），总数 69；治理台应当只有 21 件。
- 货架条目 `groupOf()` 落到 `workbench`，于是**每件货架都画了一个启停开关**（`data-gov-action="toggle"`），点了会写 `modules.enabled.<套件 id>`——而套件的启停真源是 `GET/PUT /api/suite/state`（`suite-state.json`），这个键没有任何消费者，是**死配置**，正好违反 AGENTS.md「界面上出现的每个设置项必须有真实消费者」。
- 货架通常没有 `requires`／`dependents`（少数有 `appliesTo`），卡片体基本是空的；它们真正的家在「全部套件」一节，不该出现在治理台。

规划书 §四-4.4 的原话是「治理台只管 21 件模块；左右栏 UI 面板插拔独立为『面板』入口；动态装载的可执行件归『本机模块』——三个概念各归其位」。

## 任务

### 1. 治理台只取 21 件模块

`public/views/governanceViews.mjs`：

- 新增并具名导出纯函数 `isGovernanceModule(module)`：`class === 'kernel'` 或 `class === 'workbench'` 或 `role === 'host-composition'` 为真，其余（含 `class: 'suite'`）为假。
- `governanceModel` 只对通过该判定的条目出卡；`total` 是**模块数**（内置 21，加本机模块会变多），不是数组长度。载荷里没有 `class` 也没有 `role` 的条目一律不出卡（老/畸形载荷不得凭空变成工作台）。
- 货架条目一个都不进治理台（它们由「全部套件」负责，OS-204 会把取数并到同一投影）。

### 2. 卡片体默认展开的判定要与工单一致

`pluginCardHtml(card, options)` 的行为保持：`options.expanded === true` 才出卡体。**另外**给 `governanceHtml` 一个可点的入口：`options.expandedId` 与卡片 id 相同时该卡默认展开（这样「点节点定位到卡」在 OS-202 能直接用）。不改变现有调用方行为。

### 3. 测试

`test/governanceViews.test.mjs` 新增（不改弱现有断言）：

- 用真实形状的夹具：21 件模块＋至少 3 件 `class:'suite'` 的货架条目 → `governanceModel` 的 `total === 21`、三组卡片数 `7/12/2`，且**任何一组里都没有货架条目**（按 id 逐个断言不存在）。
- 同一夹具里给货架条目带上 `settings` 与非空 `settingsHint` → 治理台输出的 HTML 里不出现它的 id、不出现它的名称。
- `isGovernanceModule`：kernel／workbench／host-composition 为真，`class:'suite'`、无 `class` 且无 `role`、`{}`、`null` 为假。
- 回归护栏：把一条货架条目伪造 `group:'workbench'` 也仍不出卡（判定看 `class`／`role`，不看 `group`）。

## 不做

- 不改 `/api/plugins`（后端已经对 69 条统一推导，这是对的）；不改货架自己的启停路径；不在治理台里做套件启停。
- 不动「全部套件」一节与其它工单的面。

## 验收

- 机器门禁全绿；`app.js` 行数不增（当前 10,096）；`git diff --check` 干净。
- 生产调用点贴出来（`文件:行`）：`isGovernanceModule` 在 `governanceModel` 里的过滤处。
- 反证一则：把过滤临时去掉，新测试必须红（工作台组变 60）；贴输出后还原。
