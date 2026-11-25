# OS-197a · 迁移器接线返工：修好迁移器后要能重试＋回退保护下沉到能力解析

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-197（Qoder 施工，落袋提交见看板；监督线验收主体通过） |
| 对应 | OS-197 任务 1（时机）与任务 3（回退保护） |
| 依赖 | OS-197 |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/workorders/OS-197a-migration-rework.md` |
| 风险 | 中——动的是迁移重试与能力解析两条主干路径；对外契约一个不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 已经站得住、不要动坏的部分（监督线实测）

隔离 daemon 上 13 项探针 12 项通过：迁移按库触发、没打开过的库不动；数据升档后路由指向覆盖者；重开幂等；覆盖者移除后依赖该能力的模块端点明确拒绝（`DATA_VERSION_AHEAD`，409）；迁移器抛错 → 本次请求 500 `MIGRATION_FAILED`、数据逐字节原样、覆盖者被剔除并回落内置、报告点名；**迁移器写库外路径被拒、库外没有文件**；**没有对应覆盖的迁移声明在身份门就被拒**。

## 要返工的两处（监督线实证，脚本 `D:\Pinax-e2e\.zcode\tmp\probe-197.mjs` 场景 5、`probe-197b.mjs`）

### 1. 迁移器修好之后，刷新不会重试

迁移器抛错 → 把 `migrate.mjs` 修好 → 调 `/api/module-roots/refresh` → 数据仍是 v1、路由仍落在内置 v1。原因：迁移器入口文件（`migrations[].entry`）不在模块的内容摘要里（它不在入口的 import 图上），层没变，命中的还是失败缓存。作者只能靠停用再启用、或重启 daemon 才能重试。

### 2. 回退保护只挡了「模块自己的端点」这一条路

覆盖者移除后直接解析能力：`resolveCapability(root, 'text.analyze')` 仍返回 `ok:true`、`provider: 'text'`、`version: 1`——旧供给者的句柄照发。`dataVersionAheadFor()` 只在 daemon 的 HTTP 端点闸上、且按「端点归属」判：宿主自有端点（归属为空）、钩子、MCP 的分析直连都走不到这道闸，拿到句柄就会静默误读。

## 任务

### 1. 迁移器入口计入身份

- `migrations[].entry` 指向的文件计入模块内容摘要，并纳入静态扫描与运行期解析钩子的管辖（它是会在本进程里执行的可执行依赖）。
- 修好迁移器后刷新＝新层＝重试。守护测试：迁移器抛错 → 修好 → 刷新 → 数据 v2、路由指向覆盖者、journal 为 `done`。

### 2. 回退保护下沉到能力解析

- 能力解析（`resolveCapability` 及其下游各 `resolve*Capability`）对「该库这项能力的数据版本高于路由供给者版本」的情况直接返回 `{ ok: false, code: 'DATA_VERSION_AHEAD', … }`——**供给者自己拒绝**，所有消费者（模块端点、宿主自有端点、钩子、MCP）统一拿不到旧句柄。
- 端点闸保留：给用户看得懂的说明与修复路径（重新启用覆盖者或执行回退迁移）。
- 守护测试：覆盖者移除后，`resolveCapability(root, <能力>)` 返回 `DATA_VERSION_AHEAD`；经宿主自有端点与钩子路径同样拿不到句柄；没迁过的库不受影响；回退迁移/重新启用覆盖者后恢复。

### 3. 小项

- `readDataVersions` 用元数据目录常量，不写死 `.openstory`。

## 不做

- 不改任何对外契约的既有字段；不改落盘格式；金样测试一个字不动。不碰作者真库与真实院子；不重启、不连接 8807。

## 验收

- 机器门禁全绿；红线测试 `test/capabilityMigrationWiring.test.mjs`、`test/capabilityMigration.test.mjs`、`test/localModules196a.test.mjs`、`test/handlerDispatch.test.mjs` 全绿。
- 监督线复跑 `probe-197.mjs`（13 项全过）与 `probe-197b.mjs`（解析层拒绝）。
- 回报里贴：迁移器入口计入摘要的位置（`文件:行`）、解析层拒绝的判定点、新增守护测试清单。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
