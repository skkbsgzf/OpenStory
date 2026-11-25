# OS-191 · 能力图与迁移框架自洽

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 4 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B2、B3、B4、B8，§五 D8 |
| 依赖 | OS-188a |
| 允许改动 | `src/protocol/capabilityGraph.mjs`、`src/protocol/capabilityMigration.mjs`、`src/services/suites.mjs`、`test/capabilityGraph.test.mjs`、`test/capabilityMigration.test.mjs`、`test/suiteModuleManifest.test.mjs`、`docs/protocol/module-manifest-2.md`、`docs/workorders/OS-191-graph-migration-consistency.md` |
| 风险 | 低——纯函数，目前没有生产调用方；但这是 OS-196 接线前的地基 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

能力图（判「谁有资格覆盖谁」）与迁移框架（执行迁移）用同一套规则说话；迁移 journal 能扛住提交中途崩溃；回退链在「被覆盖的供给者缺席」时也成立。

## 现状（监督线探针实测，脚本 `D:\Pinax-e2e\.zcode\tmp\accept-d-probes.mjs` 的 A1–A7）

1. **两套校验互斥**：覆盖者同主版本换金样并声明 `3→3` 的迁移器——能力图放行（`capabilityGraph.mjs:163-172`），迁移框架拒（`MIGRATION_VERSION_GAP`，`capabilityMigration.mjs:70`）。升到 5 并声明 `3→5`——图放行、框架拒。
2. **回退供给者被停用时判错**：停用被覆盖的内置件、覆盖者仍在——覆盖者被判 `SELF_OVERRIDE` 进 degraded，消费者得到 `CAPABILITY_MISSING`；界面上看到的是「w 缺少 x.cap@3」，而不是放行。
3. **journal 不完整**：`running` 态落盘时 `files` 恒为空（`capabilityMigration.mjs:255-268`），`files` 只在 `done`／`failed` 时才写——提交中途崩溃后，恢复逻辑无从知道哪些文件已写。`recovered` 态只被读、从未被写。回滚失败被 `.catch(() => {})` 吞掉（:204-205），却报「原数据已保留」。
4. **可执行扫描是黑名单**（`src/services/suites.mjs:85-107`）：漏 `.node`、`.exe`，以及能带脚本的 SVG 与带内联事件的 HTML。
5. **迁移改不了库内运行态**：`readFile` 与落盘都过 `resolveInsideRoot` 默认口径，拒绝 `.openstory/`（`capabilityMigration.mjs:122,180`）。

## 任务

### 1. 校验对齐

- 同主版本换金样：能力图直接 `OVERRIDE_REJECTED`，理由 `GOLDEN_CHANGE_REQUIRES_MAJOR`（协议原文：向后兼容加键不升版，改格式必须升主版本）；不再要求迁移器。
- 升主版本的覆盖：只在 `供给版本 === 被覆盖版本 + 1` 时接受，且必须带 `from === 被覆盖版本`、`to === 供给版本` 的迁移器；升两档以上 `OVERRIDE_REJECTED`，理由 `OVERRIDE_MIGRATION_GAP`。
- `docs/protocol/module-manifest-2.md` 的覆盖与迁移两节同步这两条规则。

### 2. 回退语义补全

被覆盖的供给者不在场上（被停用、或缺席）时：若同能力只剩覆盖者一个供给者，这条覆盖声明**不生效**——覆盖者按普通供给者装载、不进 degraded、路由指向它。`SELF_OVERRIDE` 只留给「场上除自己之外没有该能力、却仍声明覆盖别人」之外真正自覆盖的错误声明。停用被覆盖的内置件时 `deriveModuleStateChange` 放行。

### 3. journal 补全

- 进入提交前，`running` 态 journal 写入**完整计划**：每个文件的相对路径、写前哈希（存在时）、备份相对路径。
- 每写完一个文件，把该文件标成已提交并重写 journal，再写下一个。
- 恢复：已提交的从备份恢复，未提交的不动；恢复成功后 journal 记 `recovered`，再决定是否重试。
- 回滚失败逐条上报（`rolledBack: false` 与错误清单），不再吞掉；对外信息如实区分「已原样回滚」与「回滚未完成」。
- 不留死状态：`MIGRATION_JOURNAL_STATE` 里的每个值都要有写入点。

### 4. 可执行扫描改白名单

套件目录里只许数据与说明：`.json .md .txt .yaml .yml .css` 与位图 `.png .jpg .jpeg .webp .gif .ico`、字体 `.woff2`。HTML、SVG、WASM、任何脚本扩展名一律拒收（理由不变：套件只许数据与说明）。

### 5. 迁移可读写库内运行态

能力迁移只能来自内核件或工作台（套件禁止），与模块代码同级可信：迁移上下文的 `readFile`／`listFiles` 与提交落盘放开 `.openstory/`；`.history` 里除迁移自己的备份目录外仍然禁止。

## 测试

- 校验对齐：同主版本换金样被拒；`3→4` 带迁移器通过；`3→5` 被拒；两套校验器对同一组输入的判定一致（逐组对照）。
- 回退语义：停用被覆盖的内置件 → 放行，覆盖者 loaded，消费者不缺能力；覆盖者随后也被停用 → 才回退到内置件缺席的断链报告。
- journal：构造「`running` 且部分文件已提交」的 journal，恢复后已提交的回到原样；回滚注入失败 → `rolledBack: false` 且错误逐条可见；`recovered` 有写入点。
- 白名单：`.node`、`.exe`、`.svg`、带 `onerror=` 的 HTML 全部拒收；`.md`、`.json`、`.png` 通过。
- 运行态：迁移计划写 `.openstory/state.json` 成功且有备份。

## 不做

- 不给迁移器接生产调用方（OS-196）；不改对外端点与 MCP 工具名；不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁全绿；红线测试 `test/capabilityGraph.test.mjs`、`test/capabilityMigration.test.mjs`、`test/suiteModuleManifest.test.mjs` 全绿。
- 复跑监督线探针 `D:\Pinax-e2e\.zcode\tmp\accept-d-probes.mjs`：A1–A4 不再出现「图放行、框架拒」；A6 放行；A7 覆盖者 loaded。贴输出。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
