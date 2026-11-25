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
