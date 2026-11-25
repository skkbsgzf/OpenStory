# OS-197 · 迁移器接线：生产调用点＋失败安全阀＋回退保护

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 10 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B1；规划 §2.4 覆盖协议「迁移器责任」、§2.5 迁移协议；ADR 0003 §三 G5、§四 6 |
| 依赖 | OS-196（有了本机模块根，覆盖与迁移才有真实的来路） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`README.md`、`docs/protocol/module-manifest-2.md`、`docs/workorders/OS-197-migration-wiring.md` |
| 风险 | **中高**——迁移改的是库里的落盘数据；失败路径必须先于成功路径被测试 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

迁移器从「只有测试在调」变成真实链路的一环：**覆盖者带着迁移声明进入某個库的快照时，迁移在路由生效前执行一次；失败时覆盖者被剔除、数据原样；覆盖者退场后旧供给者不会静默误读新格式的数据。**

## 现状（监督线验收实测）

- `runCapabilityMigrations`／`declaredCapabilityMigrations` 只有 `test/capabilityMigration.test.mjs` 在调；20 份内置 manifest 没有一个声明迁移。
- 「失败安全阀：`MIGRATION_FAILED` → 禁用覆盖者」写在函数注释里（「由调用方禁用覆盖者」），但没有调用方。

## 任务

### 1. 生产调用点

- 库的候选快照里出现带 `migrations` 声明的覆盖时，在路由对该库生效前执行这些迁移：时机＝该库首次授权、以及之后每次快照重建（启停模块、登记或移除模块根）时发现「已声明、未执行」的迁移。journal 落 `.openstory/migrations/`，`done` 直接跳过（幂等）。
- 回报里贴出调用点（`文件:行`）。

### 2. 失败安全阀

迁移失败（含崩溃后恢复失败）：该覆盖者从该库的候选图里剔除，路由回落到被覆盖者；错误进 `/api/plugins` 启动报告与本次请求的错误信封（`MIGRATION_FAILED`，HTTP 500，带 journal 路径与已回滚清单）；绝不留半迁状态。下一次打开该库时按 journal 恢复后再试，不盲跑。

### 3. 回退保护

迁移成功后数据是新格式。覆盖者被停用或模块根被移除、路由回退到旧供给者时：

- 旧供给者必须**明确拒绝**并报告（新错误理由，如 `DATA_VERSION_AHEAD`），不许静默误读；
- 报告里说清：「这个库的数据已经是 N+1 格式；重新启用覆盖者，或执行回退迁移」。回退迁移（新→旧）暂不自动执行——规划原文就是「不自动回滚」，但必须让作者看得见、有路可走。

数据格式的版本以迁移 journal 为准（哪个能力、从几到几、作用在哪些文件）。

### 4. 真实链路的验证

守护测试全部走真实路径：临时模块根里放一对模块——被覆盖的内置能力与一个声明覆盖＋迁移的本机模块——经 OS-196 的信任门登记到临时院子，然后：

1. 迁移成功：数据变成新格式，路由指向覆盖者，journal 是 `done`；再开一次不重跑。
2. 迁移器抛错：数据逐字节回到原样，覆盖者被剔除，路由指向内置件，报告点名 `MIGRATION_FAILED`。
3. 停用覆盖者：路由回退，旧供给者报 `DATA_VERSION_AHEAD`，不静默误读。
4. 崩溃后重开：`running` 且部分已提交的 journal 能恢复（接 OS-191 的恢复逻辑）。

## 不做

- 不给任何内置能力凭空加迁移声明（没有真实的格式升级需求）；不自动执行回退迁移。
- 不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁全绿；红线测试 `test/capabilityMigration.test.mjs`、`test/capabilityGraph.test.mjs` 全绿；任务 4 的四条守护测试贴输出。
- 生产调用点与失败安全阀的剔除点贴出来（`文件:行`）。
- `docs/protocol/module-manifest-2.md` 的迁移一节补齐「执行时机、失败处理、回退保护」；`README.md` 的数据格式段同步。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
