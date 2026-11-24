# OS-152 · 段 B 第 1 步：管道件转自有（errors／atomicWrite／fsDurability，123 行）

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.1） |
| 对应 | 路线 G9a（作者裁定：全部转自有、重新命名） |
| 依赖 | OS-151 设计稿已验收（`dc72131`）；作者 A/B/C 已拍板 |
| 允许改动 | `src/kernel/**`、`src/protocol/hostWrite.mjs`、`src/protocol/kernelPlumber.mjs`、`test/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`core/.vendored-manifest.json`（**只在工单明确允许的范围内**，见任务 5） |
| 风险 | 低（影子复制，core 原件保留） |
| 状态 | 待派 |

## 目标

把三个「管道件」复制进 `src/kernel/`，让宿主管道改用自己的那份；**core 原件保留不动**，等最后一个 core 侧消费者（`factFileStore`）搬家时再删（设计稿 §0.3-1 的影子迁移规矩）。

**本单不删任何 core 文件、不从 vendor 清单除名**（设计稿 §6.7 的表：这一步 core 剩余仍是 24 个文件）。

## 动工前必读

- 设计稿 `docs/plan/kernel-own-design.md` 的 §0.3-1（影子迁移）、§5.1（五组出口去向）、§6.1（本单细则）、§6.7（删除账）。
- `core/pinax/next/kernel/errors.mjs`、`core/pinax/next/fs/atomicWrite.mjs`、`core/pinax/electron/projects/fsDurability.mjs` 三个源文件。
- `src/kernel/pinaxAdapter.mjs`（`:41-44` 引这三个）、`src/protocol/hostWrite.mjs`（`:22` 引 `TMP_PREFIX`／`syncDirectory`）、`src/protocol/kernelPlumber.mjs`。
- 红线测试：`test/hostWrite.test.mjs`、`test/changelog.test.mjs`、`test/historyRetention.test.mjs`、`test/decoupleStep3.test.mjs`。

## 任务

1. **复制三件到 `src/kernel/`**（逐字复制，只改文件名与必要的相对 import）：
   - `errors.mjs` → `src/kernel/errors.mjs`：表名 `NEXT_ERROR_CODES` **改为** `KERNEL_ERROR_CODES`；**26 个码值一个字都不许改**（C 的改名在 OS-157 一次扫净，本单不改值）；`ok`／`fail` 形状逐字保留。
   - `atomicWrite.mjs` → `src/kernel/atomicWrite.mjs`：其中对 `../../electron/projects/fsDurability.mjs` 的 import 改为 `./fsDurability.mjs`。
   - `fsDurability.mjs` → `src/kernel/fsDurability.mjs`：逐字复制。
2. **重指向**（只改这三处的消费者，别的先不动）：
   - `src/kernel/pinaxAdapter.mjs`：`ok/fail`、`writeFileAtomic/TMP_PREFIX`、`syncDirectory` 改指 `./errors.mjs`、`./atomicWrite.mjs`、`./fsDurability.mjs`；`factFileStore`／`deduce`／`enrich` 三组**仍指 core**（它们搬家是后面几步）。
   - `src/protocol/hostWrite.mjs`：`TMP_PREFIX`／`syncDirectory` 改从 `src/kernel/` 取（不许再经 adapter 绕道，除非 adapter 已导出它们——按现状判断，写清你怎么选的）。
   - `src/protocol/kernelPlumber.mjs`：同样改指新位置。
   - **不许改** `core/**` 任何文件。
3. **新增 `test/kernelPlumber.test.mjs`**：
   - 码表 26 个**值**逐字锁定（快照式断言，防后续顺手改名改值）；
   - 未知码回落 `INVALID_INPUT`（值仍是 `PINAX_INVALID_INPUT`，本单不改）；
   - `writeFileAtomic` 的三条行为：失败清场（临时文件不残留）、`TMP_PREFIX` 前缀、`syncDirectory` 被调用（可用注入桩）；
   - `src/kernel/` 的三件与 core 原件**行为等价**（同一输入下同值；能直接对比就直接对比）。
4. **红线测试逐个跑一遍并报告**：`test/hostWrite.test.mjs`、`test/changelog.test.mjs`、`test/historyRetention.test.mjs`、`test/decoupleStep3.test.mjs`（后者里 4 处 `PINAX_*` 字面量断言必须仍然绿——这是「本单不改值」的证据）。
5. **vendor 清单**：本单**不做除名**。若你发现清单里有本单必须动的地方，写进交付说明，不要自己改。
6. **文档**：`ARCHITECTURE.md` 的分层表按 `npm run arch:stats` 回写；`AGENTS.md` 若需补一句「内核管道件自持位置」就补。

## 不做

- 不删 core 文件、不除名 vendor 清单、不改码值、不改 `host-api@1` 形状。
- 不动 `factFileStore`／`deduce`／`enrich`／`fact/domain` 的 import 指向（那是 OS-153~156）。
- 不动 `public/**`、`vendor/**`、`package.json`。
- 不引任何依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 547 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（当前 19 项，只增不减；S2.4「内核唯一进口」仍是绿）。
- `node scripts/vendor-drift.mjs check` 退出 0。
- `node scripts/arch-stats.mjs --check` 通过（生成段与实测一致）。
- 报告里给出：三件的行数核对（123 行合计）、26 个码值未变的证据（快照测试输出）、`core/pinax` 仍是 24 文件 4,332 行。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **`core/**` 一个字都不许改**（本单是影子复制，core 原件必须逐字保留）。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
