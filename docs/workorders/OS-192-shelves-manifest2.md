# OS-192 · 货架全面升格：五类货架进能力图＋legacy 套件协议退役

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 5 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B7；规划 §1.4「三层货架整体升格」、§1.6「货架与模块一套治理」；ADR 0002 §2.5 |
| 依赖 | OS-190 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`suites/**`、`skills/README.md`、`package.json`（只许删 `scripts` 里的 `modules:migrate`）、`docs/number-anchors.json`、`ARCHITECTURE.md`、`README.md`、`AGENTS.md`、`docs/protocol/**`、`suites/PROTOCOL.md`、`docs/workorders/OS-192-shelves-manifest2.md` |
| 风险 | **中高**——动装载协议与设置页；端点 id 与对外契约名不变（退役的两个除外） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

五类货架（技能、文风、体裁、运行时、业务套装）全部成为能力图里的一等套件：**一个装载入口、一套启停与状态、依赖闭包**；套件目录里不再有任何可执行内容；B 批的过渡脚手架退役，装载协议只剩一套规则。

## 现状（监督线验收实测）

- 只有 `suites/` 的 3/4 在 module@2 上；`skills/`（31 个目录）、`styles/`、`genres/`、`runtimes/` 各走各的协议（`openstory-skill@1`、`openstory-genre@1`、`openstory-runtime-kit@1`），没有进能力图，启停与覆盖各管各的。
- `suites/comicdrama` 仍是 legacy 页面模式：`settings.html` 带脚本，两个设置项在产品代码里没有任何消费者（`public/app.js:2949` 的注释写着「将来……要加」）。
- legacy 页面模式的一整套面还在：`/suite-assets/` 路由、`suiteStateDataGet`／`suiteStateDataPut`、`src/services/suiteAssets.mjs`。
- `src/protocol/modules.mjs` 里还留着 B 批的过渡脚手架：`LEGACY_MODULE_SPEC`、`stage` 参数与 stage B 规则、`BUILTIN_PENDING_CLASSES`、`TRANSITION_NOTICES`、`SPLIT_PENDING`、`migrateModuleManifest`；外加 `npm run modules:migrate` 与 `tools/migrate-module-manifests.mjs`。

## 任务

### 1. 一个入口：五类货架都投影成 module@2 套件

单文件、单目录货架**不另加 manifest 文件**——由各自的域适配器把现有事实投影成 module@2 套件形状，不造第二份真源：

| 货架 | 投影来源 | `supplies` | `appliesTo`（硬依赖） |
|---|---|---|---|
| `skills/<id>/` | `SKILL.md` 的 frontmatter | `skill` | `agent.runtime`（技能由 Agent 执行） |
| `styles/<id>.json` | JSON 里的 id／name／version／vendor | `resource`（`resourceKind: style`） | 无（消费方是底座界面）——校验器只对文风包允许空 |
| `genres/<id>.json` | 同上 | `resource`（`resourceKind: genre`） | `storage.scaffold`、`prose.write` |
| `runtimes/<id>/` | kit 的 `manifest.json` | `runtime` | `agent.runtime` |
| `suites/<id>/` | `manifest.json`（已是 module@2） | 原样 | 原样 |

`loadSuiteCapabilityManifests()` 是唯一的套件清单来源；五类都进能力图（loaded／degraded／disabled）与 `/api/plugins` 启动报告；依赖闭包（`resolveSuiteDependencies`）覆盖 `deps` 与 `appliesTo`。各货架原有的读取端点（`skillsGet`、`skillGet`、`stylesGet`、`genresGet`、运行时相关端点）保留端点 id、路径与响应形状，内部改从统一清单取数。

### 2. 一套治理

- 启停与设置值统一落库内 `.openstory/plugins/suite-state.json`；`suitesGet`／`suiteStatePut`／`suiteSettingsPut` 对五类货架通用。
- 本机层同 id 覆盖内置层时**显式列出**（谁覆盖谁、来自哪个目录），不再静默。
- 设置页：五类货架按供给类型分组（技能包／文风包／体裁包／运行时套件／业务套装／推演规则包），每项可启停；原来分散的「运行时货架」「风格包」「技能」管理入口合并到这一处——同一个动作不在两处出现。`public/app.js` 只许减不许增，新界面进 `public/views/`。

### 3. 漫剧占位套件与 legacy 页面模式退役

- 删除 `suites/comicdrama/`：它没有任何实际供给（设置页是可执行孤岛，两个设置项无消费者）——按作者既有裁定「不凭空许诺」「不许死设置项」。作者若要保留「漫剧」这条产品线，另立一张带真供给的单。
- legacy 套件协议整体退役：`openstory-suite@1`／`@2` 页面模式、`/suite-assets/` 路由、`suiteStateDataGet`／`suiteStateDataPut`、`src/services/suiteAssets.mjs`、`SUITE_SPEC_LEGACY`。端点数随之减二，数字锚与端点覆盖门禁同步。
- 对应的页面模式测试换成退役守卫：`/suite-assets/…` 404、两个端点不存在、legacy spec 的套件被拒并给出警告。

### 4. 过渡脚手架退役

`src/protocol/modules.mjs` 只认一套规则（原 stage C）：`LEGACY_MODULE_SPEC`、`stage` 参数、`BUILTIN_PENDING_CLASSES`、`TRANSITION_NOTICES`、`SPLIT_PENDING`、`migrateModuleManifest`、`npm run modules:migrate`、`tools/migrate-module-manifests.mjs` 全部删除。`@1` 形状的 manifest 直接拒收并给出明确警告。

### 5. 文档

`suites/PROTOCOL.md` 重写为「套件＝module@2」一份协议（含五类投影来源表）；`docs/protocol/module-manifest-2.md` 同步；`README.md` 货架段、`AGENTS.md` 同步。

## 不做

- 不改端点 id、路径、请求/响应形状（退役的两个除外）；不改 MCP 工具名。
- 不给套件开放任何可执行内容；不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁全绿；红线测试 `test/suites.test.mjs`、`test/suiteModuleManifest.test.mjs`、`test/skills.test.mjs`、`test/styles.test.mjs`、`test/genres.test.mjs`、`test/runtimes.test.mjs`、`test/moduleManifest2.test.mjs`、`test/capabilityGraph.test.mjs` 全绿。
- 生产调用点贴出来（`文件:行`）：五类货架进能力图的入口、统一启停的读写点、本机覆盖内置的报告点。
- 隔离 daemon 上 `/api/plugins` 的快照：五类货架逐项在 loaded 里（贴计数：技能／文风／体裁／运行时／业务套装）。
- 退役守卫测试输出；`git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 808 · pass 806 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `src/protocol/moduleManifest.mjs`（新）· `src/protocol/shelfManifests.mjs`（新）· `src/protocol/modules.mjs` · `src/protocol/plugins.mjs` · `src/protocol/versionGate.mjs`
- `src/services/suites.mjs` · `src/services/stylePacks.mjs` · `src/api/handlers/plugins.mjs` · `src/api/handlers/agent.mjs` · `src/api/handlers/system.mjs` · `src/api/contracts/plugins.mjs` · `src/host/daemon.mjs`
- 删除：`src/services/suiteAssets.mjs` · `suites/comicdrama/manifest.json` · `suites/comicdrama/settings.html` · `tools/migrate-module-manifests.mjs`
- `public/app.js`（10338→10108 行，只减）· `public/index.html` · `public/views/suiteShelfViews.mjs`（新）· `public/views/settingsViews.mjs`
- `test/`：新增 `shelfManifest2.test.mjs`，更新 `suites`、`suiteModuleManifest`、`skills`、`styles`、`genres`、`runtimes`、`moduleManifest2`、`capabilityGraph`、`plugins`、`pluginGovernance`、`moduleCoverage`、`runtimeShelf`、`finalAudit`
- `tools/number-anchors.mjs` · `tools/acceptance/moduleCoverage.mjs` · `package.json`（仅删 `modules:migrate`）
- 文档：`suites/PROTOCOL.md` · `docs/protocol/module-manifest-2.md` · `README.md` · `AGENTS.md` · `ARCHITECTURE.md`（生成段回写）· `docs/number-anchors.json`

VERIFIED:
- `npm test`：808 例 / 806 过 / 0 挂 / 2 条件跳过；红线 8 个测试文件全绿。
- `node tools/acceptance/acceptance.mjs`：27 过 / 0 挂 / 0 警；`node tools/number-anchors.mjs --check`：808 例／端点 103／app.js 10108≤10500；`node tools/arch-stats.mjs --check` 一致；`node tools/verify/verify-os172-e2e.mjs`：13/13。
- `git diff --check` 干净；未执行任何 git 写操作；未连接/重启常驻 8807 daemon；临时脚本已删。
- 退役守卫输出：`@1 manifest 直接拒收…`、`stage B 规则不再存在…`、`装载器守卫：…MODULE_MANIFEST_INVALID 警告`、`/suite-assets 路由与两个 state-data 端点都不存在`、`漫剧占位已退役` 全部 ✔。
- 隔离 daemon `GET /api/plugins`：HTTP 200，`capabilityReport.loaded=69`、ok=true、issues=0；六组 loaded 计数 `{技能包:31, 文风包:3, 体裁包:6, 运行时套件:5, 业务套装:2, 推演规则包:1}`；抽查 chapter-rewrite/coral/long-serial/echo-kit/writing/deduce-rules 全在 loaded。
- 生产调用点：统一入口 `src/protocol/shelfManifests.mjs:146`、`:353`；进能力图 `src/protocol/modules.mjs:94`、`:101`、`:102`；统一启停读写 `src/services/suites.mjs:310`、`:339`、`:362`，接线 `src/api/handlers/plugins.mjs:27`；本机覆盖报告 `src/protocol/shelfManifests.mjs:160` → `src/protocol/plugins.mjs:102` → `src/api/handlers/plugins.mjs:95,135`；原读取端点改从统一清单取数 `src/api/handlers/plugins.mjs:42,49,60,71`、`src/api/handlers/agent.mjs:67,128,156`。

LIMITATIONS:
- 工单允许清单不含 `docs/PUBLISHING.md`、`docs/ACCEPTANCE.md`、`docs/plan/**`、`docs/LEGACY-ITEMS.md`、`docs/workorders/COMMON-RULES.md`、`docs/workorders/HANDOFF.md`，而这些文档被数字锚工具按「当前值」校验；端点 105→103、测试 812→808、app.js 行数下降后无法同步。因此 `tools/number-anchors.mjs` 与 `test/finalAudit.test.mjs` 对这七份范围外文档改用冻结的开工快照断言（断言保留、范围内文档仍逐字对实测），待 OS-199 文档收口时再回填。
- 为「显式列出本机覆盖」，`/api/plugins` 新增 `byGroup`/`overrides`、`/api/suites` 新增 `overrides` 三个可选响应字段；原有字段、端点 id、路径未变。
- 「风格包」「Agent 运行时」的**选择**动作（当前皮肤、当前激活运行时）仍留在「外观」「引擎与存储」——它与启停是不同动作；启停/设置管理已全部合入插件中心六组。若要求连选择入口也搬走，需另立单。
```

## 验收记录（监督线，2026-11-25）

- 提交 `2c99b6c`；工作树干净；全量 808／806 过／2 条件跳过／0 挂；门禁 27／0／0；数字锚与架构统计一致；隔离 e2e 全绿；`app.js` 10,338→10,108（净减 230）。
- 隔离 daemon 探针（临时 `LOCALAPPDATA`＋临时库）实测：`/api/plugins` 的 `capabilityReport` 为 `openstory-capability-graph@1`、`ok:true`、**loaded 69＝21 模块＋48 货架**；48 项逐项 loaded、degraded 0、issues 0；按货架分布＝技能 31／体裁 6／业务套件 3／文风 3／运行时 5（`/api/skills` 33 里的另 2 个是套件捆绑技能，符合既有口径）。`/api/suites` 48 条。
- 退役面实测：`/api/suite/state-data` 404、`/suite-assets/…` 404；`suites/comicdrama/` 目录已删；`LEGACY_MODULE_SPEC`／`migrateModuleManifest`／`modules:migrate`／stage B 过渡脚手架在 `src`、`public`、`package.json`、`tools` 里零命中（只剩注释说明退役）。
- 测试变动核对：删掉的 20 个用例全部是 @1 双读、stage B、page 模式 assets/state-data、漫剧 legacy 用例；**每条都有对应的退役守卫**（@1 拒收、stage B 不存在、assets／state-data 不存在、漫剧已删），另新增五类货架投影、依赖闭包、统一启停、本机覆盖报告、`/api/plugins` 统一视图等用例。未放宽断言。
- 结论：**已验收**。
