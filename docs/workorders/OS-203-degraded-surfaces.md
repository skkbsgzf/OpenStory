# OS-203 · 降级显形：依赖缺失不再无声

| 项 | 值 |
|---|---|
| 批次 | 第四批第 4 张；规划见 [`plugin-frontend-batch-20261126.md`](../plan/plugin-frontend-batch-20261126.md) §5 |
| 对应 | 规划书 §三-1（最高优先）、§四-4.4「降级灰显」、§五 第 3 步；监督线实况 §4 第 2、3 条 |
| 依赖 | OS-200（slot 投影的 `degraded`／`missing`、`modules[].status`）、OS-201（治理台卡片） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中高——动页签栏主干与视图分派；`app.js` 只减不增 |
| 状态 | 待派（等 OS-201 验收） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

依赖缺失的工作台（**降级件**）在它出现的每一个位置——页签、右栏入口、顶栏动作、设置区配置卡——一律**灰显＋悬停列出缺失项**；直接进到它的视图时给一页说明。不再有「页签照常在、点进去才报错」。

## 现状（监督线 2026-11-26 实测）

- OS-200 起 `/api/plugins.slots` 里降级位置带 `degraded: true` 与 `missing`，但 `public/views/registry.mjs` 的 `projectedTabDefs`／`projectedPanelTabs` 不看它——降级页签与健康页签长得一样，点进去各处接口才回 `PLUGIN_DEGRADED`（「X 缺少所需能力，当前不可用」）。
- 右栏入口（`app.js` 的分析抽屉按钮与 `analysisOn`）、推演的「生图」按钮、顶栏「导入/导出」按钮都用 `slotHas(slot, page)`——只问「在不在投影里」，降级时照样可点。
- 「引擎与存储」里生图、识图、知识库三块用 `moduleOn(id)` 判显隐——只看启停，不看降级；`referencePageViews` 的「生成设定图」按钮同理。
- 没有任何统一拦截：深链、旧书签照样进到坏掉的页面。
- 12 件工作台里只有 8 件有页签，另 4 件在右栏／顶栏动作／设置区——「页签灰显」一条规则盖不全。

## 任务

### 1. 投影定义带上降级（`public/views/registry.mjs`）

`projectedTabDefs` 与 `projectedPanelTabs` 保留降级位置，给定义带上 `degraded: true` 与 `missing`；健康位置的定义形状不变。新增纯函数 `slotState(slots, slot, page)` → `{ present, degraded, missing }`（在不在投影里、是否降级、缺什么）。

### 2. 页签栏

降级页签灰显：`class="tab tab-degraded"`、`aria-disabled="true"`、`title` 说明缺什么；点了不切视图。标记生成放进 `registry.mjs` 或视图里的纯函数（如 `tabButtonHtml(def, { active })`），`public/app.js` 的 `renderTabs` 改调它（`app.js` 只减不增）。「＋增加页签」面板里的降级项同样灰显、不可勾选。

### 3. 另外三个位置（`public/app.js`）

`slotHas` 换成 `slotState`，调用点逐个处理：分析抽屉按钮、`analysisOn`、推演「生图」按钮、顶栏「导入/导出」按钮——**停用照旧隐藏；降级则置灰保留并带同样的 `title`**。

### 4. 右栏与设置区的内容面

- 分析降级时，右栏面板不出卡片，出一条说明。
- 「引擎与存储」里生图／识图／知识库降级时，不出可编辑表单，出一条说明（写清缺什么、谁该供给）。`public/views/settingsViews.mjs`、`analysisViews.mjs`、`referencePageViews.mjs` 需要的判定经 scope 注入，不许 views 之间互相 import。
- 说明文案统一由一个纯函数生成（建议 `missingText(missing, requires)`，放 `public/views/governanceViews.mjs` 并具名导出），各处都调它，不许各写各的。口径：「缺少所需能力：text.analyze@1（供给方：文本内核）——该工作面暂不可用」；能力在但版本不够时写供给方名称，能力没人供给时写「目前没有插件供给」；多项用分号连。

### 5. 统一拦截（兜底，`public/app.js` 的 `viewHtml`）

分派库内视图之前，先看该视图所属模块的状态：视图→模块经 `registryEntry(view)?.id` 或 `parseModuleView(view).module` 得到（页面 id＝模块 id），状态取 `state.plugins.modules`；降级就渲染一页说明（模块名、缺什么、去哪里恢复——指到设置·插件治理台），不再进到坏页面。深链、旧书签、手输 view 都走这道。说明页的 HTML 是 `governanceViews.mjs` 里的纯函数（如 `degradedViewHtml(card)`），经注入使用。

### 6. 治理台卡片同步

降级件在治理台里：状态点变琥珀、摘要写「降级 · 缺 …」、依赖行打叉、给出恢复办法。OS-201 已做的部分不重复，缺的补上；本单新增的 `missingText` 若与 OS-201 的同类文案重复，合并成一处。

## 测试（新建 `test/degradedSurfaces.test.mjs`，并在 `test/tabRegistry.test.mjs` 加例）

- **投影定义**：一个降级位置 → 定义带 `degraded: true` 与 `missing`，顺序不变；健康输入的输出与改前逐字相同。
- **页签标记**：降级定义 → `tab-degraded`＋`aria-disabled`＋`title` 列出能力与供给方；「＋」面板项带 `disabled`。
- **`slotState`**：在投影里且正常／不在／降级三种。
- **`missingText`**：有供给方（版本不够）／无供给方／多项三种文案。
- **设置区与右栏**：降级夹具 → 出说明，不出可编辑表单与卡片。
- **说明页**：`degradedViewHtml` 含模块名、缺失项与指向治理台的入口。
- **daemon 级**（沿用 OS-200 的降级夹具造法：停 `analysis`／`habits`／`roleplay` → 停内核件 `text` → 启用 `roleplay`）：真实 `/api/plugins` 的 `slots` 喂给 `projectedTabDefs` → 扮演是降级定义，其余七个页签不变。
- **源码**：`app.js` 里不再有 `slotHas(`；`viewHtml` 分派前有降级判定；`app.js` 行数不增。
- 既有红线全绿：`test/tabRegistry.test.mjs`、`test/governanceViews.test.mjs`、`test/shellViewsC6.test.mjs`、`test/os198SlotsWiring.test.mjs`、`test/pluginGovernanceProjection.test.mjs`、`test/coreModules.test.mjs`。

## 不做

- 不改后端与投影字段；不改变「停用即消失」的既有行为。
- 导航收敛与显示名迁移（OS-204／OS-205）。

## 验收

- 机器门禁全绿；`app.js` 行数不增；`git diff --check` 干净。
- 生产调用点贴出来（`文件:行`）：页签标记、四处 `slotState` 调用点、`viewHtml` 的拦截、`missingText` 的全部消费方。
- 反证一则：把降级位置临时去掉 `degraded` 标记，对应用例必须红；贴输出后还原。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 889 · pass 887 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- public/views/registry.mjs（降级投影透传、`slotState`、`tabButtonHtml`）
- public/views/governanceViews.mjs（`missingText`、`degradedViewHtml`、工厂暴露 `moduleCard`）
- public/views/settingsViews.mjs（生图/识图/知识库降级出说明、不出表单）
- public/views/analysisViews.mjs（右栏降级出说明、不出卡片）
- public/views/referencePageViews.mjs（生成设定图按钮降级置灰带说明）
- public/views/scriptViews.mjs（新增 `analysisAttrs`，默认 HTML 逐字兼容）
- public/app.js（接线；10096 → 10095 行，`slotHas` 清零）
- public/index.html（令牌化降级灰显样式）
- test/degradedSurfaces.test.mjs（新建，9 例）
- test/tabRegistry.test.mjs（新增 2 例）
- README.md、AGENTS.md、ARCHITECTURE.md、docs/number-anchors.json（数字锚回写）

VERIFIED:
- 生产调用点：`tabButtonHtml` → `public/app.js:5502`；`slotState` 适配器 → `public/app.js:5563`，四处入口 `public/app.js:1968 / 5583 / 6512 / 7430`；`viewHtml` 降级拦截 → `public/app.js:576-577`；`missingText` 定义 `public/views/governanceViews.mjs:47`，消费方 `governanceViews.mjs:65`、`settingsViews.mjs:9`、`analysisViews.mjs:82`、`referencePageViews.mjs:14`、`app.js:5420/5502/5563`。
- `node .zcode/run-gate.mjs` → `测试结果：pass=887 fail=0`。
- `node --test test/degradedSurfaces.test.mjs test/tabRegistry.test.mjs test/governanceViews.test.mjs test/shellViewsC6.test.mjs test/os198SlotsWiring.test.mjs test/pluginGovernanceProjection.test.mjs test/coreModules.test.mjs` → `tests 72 / pass 72 / fail 0`。
- `npm run arch:stats`、`node tools/number-anchors.mjs --check` → `✓ 数字锚一致：889 例／门禁 29／app.js 10095≤10500 行`。
- `node tools/acceptance/acceptance.mjs` → `验收门禁：29 过 / 0 挂 / 0 警`。
- `git diff --check` → 无输出（干净）；`app.js` 10095 行（不增）。
- 反证：临时剥掉 daemon 载荷中 roleplay slot 的 `degraded` 后，`node --test test/degradedSurfaces.test.mjs` → `✖ OS-203·daemon 降级载荷…` 断言 `+ undefined - true`，`fail 1`；已还原，复跑 `pass 9 / fail 0`。

LIMITATIONS:
- 治理台卡片内 OS-201 既有的「恢复办法：让供给方…／需要一件供给…」文案保持原样（被既有断言钉死），未并入本单 `missingText`；本单新增的四个降级位置（页签 title、四处入口、右栏/设置区说明、直达说明页）已统一走 `missingText`。
- 工单「其余七个页签」按 OS-200 原夹具实跑为 7 个页签（含降级的扮演；habits 在夹具中保持停用），测试按实测 7 个断言。
```
