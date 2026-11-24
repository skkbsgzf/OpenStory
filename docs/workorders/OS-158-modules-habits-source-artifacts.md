# OS-158 · 段 C 第 1 步：工作面插件化第二批——习惯、故事源、产物中心

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾（第一批路线 G5b 的延续；切分为主 agent 按证据重建） |
| 对应 | 路线 G5b；设计稿无关（段 C 不碰内核） |
| 依赖 | 段 A、段 B 已收口（OS-156 `ae01987`；OS-157 收尾另排） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（三个工作面升格为模块插件；要保证缺省行为一个字节不变） |
| 状态 | 待派 |

## 目标

把「重内容、低写面」的三个工作面升格为**模块插件**：习惯、故事源、产物中心。
形状照已落地的三件（分析／生图识图／知识库）做——先读它们的 manifest、启停接线与测试，不要另起一套。

## 动工前必读

- `src/modules/{analysis,comfyui,kb}/module.manifest.json` 与 `src/protocol/modules.mjs`（manifest 装载、`isModuleEnabled` 单一入口、端点归属）。
- `src/api/registry.mjs` 的端点归属表与 `src/api/handlers/*.mjs`。
- `public/views/registry.mjs`（OS-143 的 `TAB_REGISTRY`；条目上有 `dir`／`label`／`render`／`core`）。
- `public/views/settingsAggregation.mjs`（OS-145 的设置聚合；模块组已存在）。
- `public/views/runtimeShelf.mjs`（OS-149 的夹具过滤写法，可照抄风格）。
- `AGENTS.md` 第 20 条（`app.js` 增量冻结）与第 21 条（命名表）。
- 既有测试：`test/modulePlugins.test.mjs`、`test/settingsAggregation.test.mjs`、`test/moduleSettingsConsumers.test.mjs`。

## 任务（三个子件，各自独立提交）

### 子件一：习惯（habits）
1. `src/modules/habits/`：把习惯的实现移进来（现 `src/services/habits.mjs`），加 `module.manifest.json`（`core: false`，独占端点 `habitsGet`／`habitsPut`）。
2. **停用语义**：习惯停用后——页签消失（走注册表的模块可见性）、`/api/habits*` 返回 `MODULE_DISABLED`、**正文写盘前的习惯 lint 不再执行**、Agent 提示词不再注入习惯。
   后两条必须经**宿主的模块钩子**取，不许在调用点直接 import 习惯实现（这是 OS-144 分析模块的同一口径）。
3. 页签 `习惯` 加 `module: 'habits'` 归属；`computeTabDefs` 在 `ctx.modulesEnabled` 缺该模块时跳过；**ctx 没给 modulesEnabled 视为全启用**（既有快照测试一个字不改仍绿）。

### 子件二：故事源（storysource）
4. `src/modules/storysource/`＋manifest（`core: false`）；**没有独占端点**——它读 `factCurveGet`／`factEntriesGet` 等 fact 共享读端点，manifest 里独占端点留空并如实登记它读哪些共享端点。
5. **共享端点永远属于宿主**：停用故事源后，`/api/fact/entries`、`/api/fact/curve` 照常 200（世界书侧仍在用）。加测试钉住这条。
6. 页签 `故事源` 加 `module: 'storysource'` 归属。

### 子件三：产物中心（artifacts）
7. `src/modules/artifacts/`＋manifest（`core: false`，独占端点 `artifactsGet`）。
8. 页签 `产物` 加 `module: 'artifacts'` 归属；停用后该页签消失、端点返回 `MODULE_DISABLED`。

### 收口
9. **视图迁出**（`app.js` 增量冻结的延续）：把 `habitsViewHtml`、`artifactsHtml` 与故事源的纯 HTML 构造函数（`ssOutlineSideHtml`／`ssTableHtml`／`ssTraceHtml`／`ssChartFallbackHtml`／`ssModuleBodyHtml` 一类）搬进 `public/views/`；
   只搬**纯构造函数**（读入参返回 HTML）；读写模块状态、起定时器、操作 DOM 的一律留在 `app.js`。搬完在 `VIEW_RENDERERS` 改注册名。
   每个迁出的渲染函数配金样测试（固定夹具 state → 固定 HTML），并加纯度测试（不 import `app.js`、不 import 彼此）。
10. **设置聚合**：三个模块的 `settings` 按现有口径给 `settingsHint`（没有可调项也写一句指路），不许出现无消费者的死配置（`test/moduleSettingsConsumers.test.mjs` 会拦）。
11. **门禁**：S2.2 的扫描面已自动枚举 `public/views/**`（OS-150b），确认新模块被覆盖。

## 不做

- 不动内核（`src/kernel/**` 本单只读）；不改 Host API。
- 不改 `core/**`、`vendor/**`、`package.json`。
- 不改任何既有页签的缺省可见性与顺序（快照必须一个字不改）。
- 不把 `产物/正文/世界书/剧本/故事源/扮演` 之外的页签加进 `core: true`（核心可达面由 OS-143 定死）。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 598 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（19 项，只增不减）。
- **缺省页签快照一个字不改**（`test/tabRegistry.test.mjs` 的 diff 应为空）。
- `public/app.js` 行数**净下降**（当前行数以你开工时 `wc -l` 为准，写进报告）。
- 每个子件各一个提交；报告里给出：三个 manifest 的形状、停用→端点/页签/钩子三处的证据、迁出的渲染函数与金样测试清单。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **收尾必做**：`npm run arch:stats` 回写（S0.2 会拦）。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
