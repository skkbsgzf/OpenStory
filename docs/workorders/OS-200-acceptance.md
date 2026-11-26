# OS-200 验收记录（监督线，2026-11-26）

**结论：通过。** 提交 `0cfc25c`（一轮过）。施工由 CodeBuddy `hy4flash` 完成。

## 一、我自己实跑的量（克隆 `0cfc25c` 到独立目录，临时 `LOCALAPPDATA`＋临时夹具库，不碰 8807 与真库）

| 项 | 结果 |
|---|---|
| 全量测试 | 853 例 · 851 过 · 0 挂 · 2 跳过 |
| 验收门禁 | 29 过 / 0 挂 / 0 警 |
| arch check | 生成段与实测一致（51 行数据） |
| 数字锚 | 853 例 / 门禁 29 / 端点 108 / 宿主域 0 / `app.js` 10,097 ≤ 10,500 |
| 工作树 | 克隆后 `git status` 干净 |

## 二、独立探针（`accept-200.mjs`，53 项全过）

先在同一探针上试跑改动前的 `0a1a84b`，得 **14 过 / 39 挂**，确认探针量的是真改动、不是空转；再跑 `0cfc25c` 得 **53 过 / 0 挂**。

- **契约**：`moduleGraph`／`suites`／`suiteOverrides`／`suiteUserDir`／`suiteWarnings` 五个键已登记；端点数仍 108。
- **健康库**：`modules[]` 里模块恰 21 件、48 件货架条目照旧在数组里；21 件都带齐 11 个新字段、全部 `loaded` 且启用；非底座边 38 条、底座边 11 条，底座依赖方数 `base.write` 4 ／ `base.contract` 2 ／ `base.naming` 5；`fact.dependents` 恰 10 件、`fact.impact` 恰为 `['imagegen','log']`；`fact.capabilities` 7 项含 3 个金样；`roleplay.requires` 四条带供给方与版本区间全 `ok`；七个内核件的 `impact` 逐件正确；12 件工作台 `toggleCheck.ok`；`fact` 是 `CAPABILITY_IN_USE`＋10 个消费方；宿主组合面是 `INVALID_ENTRY`。
- **同源**：21 件的 `toggleCheck` 与 `deriveModuleStateChange` 逐件同结果。
- **降级链路**（走接口）：停光 `text` 的依赖方 → 停 `text`（放行）→ 重开 `roleplay`（放行）→ `roleplay.status='degraded'`、`missing` 含 `text.analyze@1`、`requires` 那条 `ok:false`、`enabled` 仍为 `true`；页签投影里 `roleplay` 带 `degraded` 与 `missing`，其余七个页签不带；`text.dependents` 里 `roleplay` 标降级；此时 `roleplay` 仍可停；再停则位置消失。手改 ui-state 也能如实投影降级。
- **同源端到端**：21 件逐件发停用补丁，HTTP 裁决与 `toggleCheck` 逐件一致；`fact` 的消费方名单与闸返回一致。
- **货架**：`/api/plugins.suites` 与同库 `GET /api/suites` 逐条一致（含设置值与 schema）；不带库时模块带 `toggleCheck`、货架仍在。
- **对抗（本单要害）**：登记临时模块根后，本机内核件 `extk` 有活跃消费方 `extw` 时**停用被拒**（`CAPABILITY_IN_USE`）——旧代码上这一步是放行 200；先停消费方再停 `extk` 放行；重开 `extw` 后它变降级、页签带降级标记。

## 三、测试不放宽审计

- 全量 diff 里测试只动了两个文件：新增 `test/pluginGovernanceProjection.test.mjs`（234 行，8 例）；`test/modulePlugins.test.mjs` 改了一行断言。
- 唯一被替换的断言：停用 `deduce` 时的活跃消费方名单 `['imagegen','roleplay']` → `['deduce-rules','imagegen','roleplay']`。这是等价加强——闸改吃同源有效清单后，以 `appliesTo` 消费 `deduce.engine` 的 `deduce-rules` 规则包也计入，漏掉它才是漏报。无 skip、无删除、无其它放宽。

## 四、反证

把 `uiStatePut` 临时改回只吃内置 `MODULE_MANIFESTS` 且不带套件状态，`--test-name-pattern="同源端到端"` 立刻变红（exit=1，`agent-runtime` 的消费方只剩 4 件内置、预期多出货架）。已还原，工作树干净。

## 五、生产调用点

- `src/protocol/capabilityGraph.mjs`：`moduleStatusProjection`、`projectModuleGraph`（纯函数）。
- `src/host/moduleRuntime.mjs`：`graphInputsFor`（唯一取数口），`snapshotFor` 改为复用它。
- `src/api/handlers/plugins.mjs`：同源取数 → 装配推导字段、`moduleGraph`、slot 状态、货架四键。
- `src/api/handlers/system.mjs`：`uiStatePut` 的闸改从 `graphInputsFor` 取数。
- `public/app.js`：`loadPlugins` 整体保留响应；`public/views/settingsViews.mjs` 删掉 `reloadLocalState`，改注入的 `loadPlugins`。

## 六、留给下一张的事

界面全部未动（本单明确不做）：降级标记已进投影但前端还不消费，治理台卡片流、能力图、灰显与设置页收敛都在 OS-201～204。
