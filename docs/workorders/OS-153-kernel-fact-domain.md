# OS-153 · 段 B 第 2 步：fact 词表与校验转自有（fact/domain 8 件，1,233 行）

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.2） |
| 对应 | 路线未列（设计稿补：这 8 件是 fact 链的表达层，清单漏了） |
| 依赖 | OS-152 已验收（`5c3a887`） |
| 允许改动 | `src/kernel/**`、`src/protocol/**`、`test/**`、`tools/acceptance/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（fact 条目的校验器，全仓写协议都过它） |
| 状态 | 施工中 |

## 目标

把 `core/pinax/next/fact/domain/` 的 8 个文件复制进 `src/kernel/fact/domain/`，让**自有的**副本成为后续事实链的底座；
`core` 原件保留（影子迁移），`factFileStore` 仍指 core——它搬家是 OS-156。

## 动工前必读

- 设计稿 §0.3-1（影子迁移）、§6.2（本单细则）、§6.7（删除账：本步删 0 个 core 文件）。
- 8 个源文件：`aliases.js`、`pediaSchema.js`（转发桶）、`perspective.js`、`schema.js`、`stableId.js`、`status.js`、`validity.js`、`vocabulary.js`。
- 现在的 `src/kernel/pinaxAdapter.mjs`（`errors/atomicWrite/fsDurability` 已指自有件，`factStore/deduce/enrich` 仍指 core）。
- `test/contracts.test.mjs`（`/api/entries` 夹具）、`test/factEntriesImport.test.mjs`、`test/decoupleStep3.test.mjs`。

## 任务

1. **复制 8 件**到 `src/kernel/fact/domain/`：
   - `pediaSchema.js` 是 re-export 桶且文件名带 vendor 谱系 → **改名为 `index.mjs`**，内部 re-export 路径指向同目录的新文件；
   - 其余 7 件保持文件名，文件内相对 import 的扩展名按现状处理（`.js` 保持 `.js`，别顺手改成 `.mjs`——那会让 diff 噪声变大）；
   - 逐字复制，**不改任何导出名、常量值、枚举顺序**。
2. **新增 `test/kernelFactDomain.test.mjs`**：
   - `validateFactEntry` 对一个三层样本（worldview／character／plot）逐字段断言：合法条目零 error；缺必填、坏类型、未知枚举各报预期码；
   - `stableEntryId`：同输入同 id（含中文名、别名不影响 id）；
   - 双时间轴：`isActiveAt`／`intersectValidity` 的边界（null、闭区间端点、交叉区间）；
   - 状态机：`draft→proposed→adopted→superseded` 合法转移与非法转移各一例；
   - **与 core 原件行为等价**：同一输入下 `validateFactEntry` 的 errors/warnings 逐条相等（能直接 import 两份就对比，用相对路径引 core）。
3. **S2.4 允许清单收紧**（来自 OS-152 的遗留）：
   `tools/acceptance/acceptance.mjs` 的 `KERNEL_GATEWAY_ALLOW` 里删掉 `src/protocol/hostWrite.mjs` 与 `src/protocol/kernelPlumber.mjs`
   ——它们已改为直取 `src/kernel/`，不再 import `core/**`；允许清单里留着＝门禁比实际松。
   删完跑门禁确认 S2.4 仍绿（`src/kernel/pinaxAdapter.mjs` 仍是唯一进口）。
4. **`src/protocol/README.md` 口径订正**：把「hostWrite／kernelPlumber 经 adapter 转供」改为「直取 `src/kernel/`」。
5. **文档**：`npm run arch:stats` 回写；`AGENTS.md` 若有内核目录的说明则同步。

## 不做

- 不删 core 文件、不改 vendor 清单、不改码值、不改 `factFileStore` 的 import（那是 OS-156）。
- 不动 `deduce`／`enrich`／`factPack`（OS-154／155）。
- 不动 `public/**`、`vendor/**`、`package.json`；不引依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 560 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（当前 19 项，只增不减；S2.4 的允许清单已收紧且仍绿）。
- `node scripts/vendor-drift.mjs check` 退出 0；`node scripts/arch-stats.mjs --check` 通过。
- 报告里给出：8 件行数合计（1,233）、与 core 原件的等价性证据（对比测试输出）、`core/pinax` 仍是 24 文件 4,332 行。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **`core/**` 一个字都不许改**。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
