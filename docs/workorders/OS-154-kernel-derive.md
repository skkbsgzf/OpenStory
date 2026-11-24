# OS-154 · 段 B 第 3 步：fact 派生与包装转自有（wikiDerive＋factPack＋enrich 2 件，984 行）

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.3） |
| 对应 | 路线 G9b（enrich 两件）＋设计稿补（wikiDerive／factPack 是它们的依赖） |
| 依赖 | OS-153 已验收（`e9835e8`） |
| 允许改动 | `src/kernel/**`、`src/protocol/**`、`test/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`core/pinax/next/fact/usecases/enrich/**`（**只许删这两个文件**）、`core/.vendored-manifest.json`（只许删对应两行） |
| 风险 | 中（这是**第一次真删 core 文件**） |
| 状态 | 待派 |

## 目标

把 fact 的「派生层与打包层」复制进 `src/kernel/`；其中 enrich 两件没有 core 侧消费者，所以可以**在这一步就真删**（设计稿 §6.7：本步 core 从 24 → 22）。

## 动工前必读

- 设计稿 §0.3-1（影子迁移）、§6.3（本单细则）、§6.7（删除账：本步删 2 个）。
- 源文件：`core/pinax/next/kernel/wikiDerive.mjs`（438 行）、`core/pinax/next/fact/usecases/factPack.js`（194 行）、`core/pinax/next/fact/usecases/enrich/pseudoChapters.mjs`（74 行）、`.../enrich/metrics.mjs`（278 行）。
- 设计稿 §9-6：`wikiDerive.mjs:22-74` 与 `enrich/pseudoChapters.mjs:20-74` 里有一段**重复的伪章公式**——本单要合并（`wikiDerive` 改引 `src/kernel/enrich/pseudoChapters.mjs`），并先加「两处同值」测试再删重复。
- 现有消费方：`src/kernel/pinaxAdapter.mjs`（`:38-39` 引 enrich 两件）、`src/protocol/factGuard.mjs`、`src/services/enrichEngine.mjs`、`test/fact-curve.test.mjs` 等。

## 任务

1. **复制三处到自有位置**：
   - `wikiDerive.mjs` → `src/kernel/fact/wikiDerive.mjs`（逐字复制；随后按任务 2 合并重复公式）；
   - `factPack.js` → `src/kernel/fact/factPack.mjs`（**扩展名改 `.mjs`**，内部相对 import 跟着改；导出面一字不动）；
   - `enrich/pseudoChapters.mjs`、`enrich/metrics.mjs` → `src/kernel/enrich/`（逐字复制）。
2. **合并重复的伪章公式**（设计稿 §9-6）：
   - 先在 `test/kernelEnrich.test.mjs` 里加一条「`wikiDerive` 的伪章结果与 `enrich/pseudoChapters` 的同值」断言（对同一组样本：0 字、1 字、恰好 2200、边界 4／12、超大）；
   - 再把 `src/kernel/fact/wikiDerive.mjs` 里那段重复实现改为 import `../enrich/pseudoChapters.mjs`；测试必须仍绿。
3. **改指向**：
   - `src/kernel/pinaxAdapter.mjs` 的 `enrich` 组改指 `src/kernel/enrich/*`；`wikiDerive`／`factPack` 的消费方（`src/protocol/factGuard.mjs`、`src/services/enrichEngine.mjs` 等）逐个改指 `src/kernel/fact/*` 或经 adapter——按现状选一种并说明；
   - **注意** `src/protocol/**` 只许经 adapter／`src/kernel/` 取，不许直接深引 `core/**`（S2.4）。
4. **删除 core 两个 enrich 文件**（本单唯一的 core 改动）：
   - `git rm` 由编排器提交时处理，你只需把文件删掉；
   - 同步删掉 `core/.vendored-manifest.json` 里对应的两行（该文件是清单，删行属本单允许范围）；
   - `core/VENDORED.md` 补一句：这两件已转自有（OS-154），出处仍是上游同名文件。
5. **新增 `test/kernelEnrich.test.mjs`**：
   - 伪章数 `clamp(round(chars/2200), 4, 12)` 的边界；
   - `causalSummary` 三个指标对一张固定的小图；
   - `deriveWiki` **幂等**（同输入跑两遍，深等）；
   - `factPack` 的打包形状（固定条目集，键齐全、顺序稳定）；
   - 与 core 原件（`wikiDerive`／`factPack` 仍在 core）的行为等价。
6. **文档**：`npm run arch:stats` 回写；`ARCHITECTURE.md` 的 L2/L3 数字会随 core 变小而变化。

## 不做

- 不删 `wikiDerive`／`factPack` 的 core 原件（它们还有 core 侧消费者，等 OS-156）。
- 不动 `deduce`／`fact/domain`／`factFileStore`；不动 `public/**`、`vendor/**`、`package.json`。
- 不改任何码值、不改 `host-api@1`。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 573 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（19 项；S2.4 仍绿）。
- `node scripts/vendor-drift.mjs check` 退出 0，且**清单里 enrich 两件已除名**（24 → 22 项；报告里贴清单计数）。
- `node scripts/arch-stats.mjs --check` 通过。
- 报告里给出：四件行数（438＋194＋74＋278＝984）、core 现在是 **22 文件**、伪章同值测试与幂等测试的输出。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **`core/**` 只许删本单点名的两个 enrich 文件并同步清单，其余一个字都不许改。**
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
