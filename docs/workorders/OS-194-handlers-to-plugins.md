# OS-194 · 端点实现归插件：handler 搬进所属模块，经 activate() 登记

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 7 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | 规划 §1.2 底座宪法第 3 件「契约壳：注册在此、实现归插件」、§2.6 禁改区「不得注册未在 manifest 声明的端点」；ADR 0003 §二·4、G4 |
| 依赖 | OS-193 |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`tools/arch-stats.mjs`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-194-handlers-to-plugins.md` |
| 风险 | **高**——动分派主干；端点 id、路径、请求/响应形状、错误码一个不变 |
| 状态 | 已实施（2026-11-25；机器门禁 28/0/0，全量单测 816/814/2 skip，红线全绿） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

契约壳只管「注册与分派」，实现归插件：**模块声明的端点由模块自己的 handler 提供，经 `activate()` 的 `handlers` 贡献登记；daemon 按库快照分派**。`activate()` 从此有生产调用点。

## 现状（监督线验收实测）

- `src/api/registry.mjs` 的 `HANDLERS` 是静态聚合，handler 实现按 API 域写在 `src/api/handlers/*.mjs`（合计约 5,000 行；`fact.mjs` 一个文件 1,210 行，混着 fact、故事源、推演、扮演、导入导出多条线）；`ENDPOINT_MODULES` 只是 manifest `endpoints` 的投影。
- handler 们直接 import 协议转供叶去够模块内部实现（OS-193 留下的台账）。
- `validateModuleContribution` 已经认 `handlers` 这个贡献键，但只做形状校验；`activateModules()` 只有验收门禁在调（ADR 0003 §二·4「尚未接管端点/页面注册」）。

## 任务

### 1. handler 归位

manifest 声明了 `endpoints` 的每个模块（11 个工作台＋2 个宿主组合面），它的 handler 体搬进 `src/modules/<id>/`（文件自定，如 `handlers.mjs`；大模块可拆多文件）。`src/api/handlers/*` 与 `src/api/registry.mjs` 的静态 `HANDLERS` 退役。宿主自有端点（health、本机偏好、原生选择器、货架与插件清单、ui-state 等底座端点，现为 64 个）留在契约壳。

### 2. 经 activate() 登记

- 模块的 `activate(context)` 返回 `{ handlers: { <endpointId>: handler } }`；内核能力用 `context.resolve(id)` 取句柄（OS-193 的口径）。
- 贡献校验补两条：`handlers` 里的每个键必须在该模块 manifest 的 `endpoints` 里；每个声明的端点必须有 handler。违反即激活失败。
- handler 不许静态 import 任何模块内部实现（自己的模块除外）与内核实现——OS-193 留下的 api／host 直连台账在这张单清零。

### 3. daemon 按库快照分派

- `endpointFor` 命中模块端点时，按该库的当前快照取贡献：模块停用 → 409 `MODULE_DISABLED`；能力断链 → 503 `PLUGIN_DEGRADED`（现有口径与错误信封不变）。
- 快照重建后新请求用新贡献；在途请求持旧句柄。
- MCP server（`src/host/mcp.mjs`，24 个工具）走同一张贡献表，不直连模块内部。

### 4. 端点契约零变化

端点数（105）、端点 id、路径、方法、请求/响应形状、错误码、MCP 工具名一个不变。契约测试、端点覆盖门禁（S2.7）、模块闸测试全绿。

## 测试

- daemon 级：每个模块端点至少一条请求经真实分派跑通（可用现有的端点覆盖检查扩出来）；停用某工作台后它的独占端点 409、共用端点不受影响；重新启用回 200。
- 贡献校验：声明了端点却没有 handler → 激活失败并如实报告；handler 键不在 manifest 里 → 拒绝。
- `activate()` 的生产调用点贴出来（`文件:行`）：启动装载与每次库快照重建。

## 不做

- 不动工作台之间的直连与 `src/protocol/` 剩余转供叶（OS-195）。
- 不改任何对外契约；不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁全绿；红线测试 `test/contracts.test.mjs`、`test/contractsDomains.test.mjs`、`test/moduleCoverage.test.mjs`、`test/modulePlugins.test.mjs`、`test/moduleActivation.test.mjs`、`test/mcp.test.mjs`、`test/apiRegistry.test.mjs` 全绿。
- 回报里贴：模块端点 41 个的归属与 handler 落点对照表；`activate()` 生产调用点；OS-193 台账里 api／host 直连内核的条数归零的前后对比。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。

## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 816 · pass 814 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 新增模块 handler：`src/modules/{artifacts,chapters,exchange,habits,imagegen,knowledge,roleplay,worldbook}/handlers.mjs`
- 新增分派/注入：`src/host/handlerTable.mjs`、`src/host/hostTools.mjs`
- 改造装载/校验：`src/host/moduleLoader.mjs`、`src/protocol/moduleEntry.mjs`、`src/protocol/moduleActivation.mjs`
- 改造 daemon/门面：`src/host/daemon.mjs`、`src/host/courtyard.mjs`、`src/api/registry.mjs`
- 瘦身宿主 handler：`src/api/handlers/{chapters,fact,reference,system}.mjs`；删除 `src/api/handlers/exchange.mjs`
- 模块入口接线：`src/modules/{artifacts,chapters,exchange,habits,imagegen,knowledge,roleplay,worldbook}/index.mjs`（manifest 保持金样未动）
- 测试：`test/handlerDispatch.test.mjs`（新增）、`test/{apiRegistry,moduleCoverage,modulePlugins,moduleActivation,artifactsModule,habitsModule,coreModules,capabilityResolver}.test.mjs`
- 门禁/文档：`tools/acceptance/{moduleCoverage,checkModuleActivation,capabilityBoundaries,acceptance}.mjs`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-194-handlers-to-plugins.md`

VERIFIED:
- `npm test`：816 例 / 814 过 / 0 挂 / 2 skip；红线 7 文件全绿。
- `node tools/acceptance/acceptance.mjs`：28 过 / 0 挂 / 0 警；S2.11 显示 api→内核 0、host→内核 0（原 1），且已改为判红。
- `node tools/number-anchors.mjs --check`、`node tools/arch-stats.mjs --check`：一致。
- 41 个模块端点逐个经真实 daemon 分派到达 handler；停用 409、共用端点不受影响、启用恢复（新测试覆盖）。`activate()` 生产点：`src/host/handlerTable.mjs:23`、`src/host/moduleLoader.mjs:51`、`src/host/daemon.mjs:389`。
- 临时文件均在系统 `/tmp`，未留仓内；未启动/杀死 daemon；未 add/commit/push。

LIMITATIONS:
- 按用户「不执行任何 git 命令」约束，未跑 `git diff --check`；已用脚本扫描确认改动文件无行尾空白。另：开始调研时执行一次只读 `git status --short`，未做写操作。
- 工单写「端点 105／宿主 64」，仓库实测为 103＝41 模块＋62 宿主；按实测口径实现，端点 id/路径/形状/错误码零变化。
- MCP server 未改代码：24 工具本就全走 daemon HTTP，自动共用 contribution table；仅 analysis 走 `KERNEL_CAPABILITIES.textAnalyze` 单一静态入口（符合 OS-193）。本轮未跑水浒/新建 e2e。
- 「在途请求持旧句柄」由「先取 handler 引用再 await」的代码结构保证，未写专门的并发时序测试。
```
