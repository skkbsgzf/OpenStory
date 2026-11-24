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

> 模型 deepseek-v4.1-flash · 第 1 轮 · 测试 绿（tests 560 · pass 558 · fail 0 · skip 2） · 门禁 绿 · 水浒 绿 · 新建 绿 · vendor 未动 · daemon 已重启（OS-152 改了后端）

```text
CHANGED:
- `src/kernel/errors.mjs`（新建：从 core 逐字复制，`NEXT_ERROR_CODES`→`KERNEL_ERROR_CODES`，值全部不变）
- `src/kernel/atomicWrite.mjs`（新建：逐字复制，import 改为 `./fsDurability.mjs`）
- `src/kernel/fsDurability.mjs`（新建：逐字复制）
- `src/kernel/pinaxAdapter.mjs`（`:45-48` 的 plumber 三件改指 `src/kernel/`；`factStore/deduce/enrich` 仍指 core；补 OS-152 注记）
- `src/protocol/hostWrite.mjs`（`:23-24` 直取 `../kernel/atomicWrite.mjs`／`../kernel/fsDurability.mjs`）
- `src/protocol/kernelPlumber.mjs`（改指 `../kernel/errors.mjs`／`../kernel/atomicWrite.mjs`，注释同步「环已断」）
- `test/kernelPlumber.test.mjs`（新建：码表快照＋未知码回落＋原子写失败清场/前缀/目录 fsync＋与 core 原件行为等价，13 例）
- `ARCHITECTURE.md`（`arch-stats` 生成段回写：L3 1→4 文件 / 68→195 行、L4 行数、测试文件 65→66；L3 节补 OS-152 说明）
- `AGENTS.md`（硬规则 1 补「内核管道件自持位置」；目录表 `src/kernel/` 行；仓内地图内核进口行）

VERIFIED:
- `node --check`：6 个改动/新增 `.mjs` 全部通过
- 三件行数核对：`errors 55 + atomicWrite 48 + fsDurability 20 = 123`；`diff --strip-trailing-cr` 对比 core，仅 errors 的 3 处标识符不同（其余两个文件零差异）
- 码值证据：`KERNEL_ERROR_CODES` 与 core `NEXT_ERROR_CODES` 键序＋值 `JSON.stringify` 完全相同；键数实测 **25**（不是工单写的 26，见 limitations）
- 红线测试逐个跑：`hostWrite` 7 例（6 过 / 1 平台 skip / 0 挂）、`changelog` 19 过、`historyRetention` 7 过、`decoupleStep3` 8 过（含 4 处 `PINAX_*` 字面量断言）
- `node --test test/*.test.mjs`：**560 例 / 558 过 / 0 挂 / 2 平台 skip**（基线 547＋新增 13）
- `node tools/acceptance/acceptance.mjs`：**19 过 / 0 挂 / 0 警**（S2.4「内核唯一进口」仍绿，扫描面 80→83）
- `node scripts/vendor-drift.mjs check`：退出 0（本仓被改 0 / 上游已变 0 / 清单缺项 0）
- `node scripts/arch-stats.mjs --check`：退出 0
- `core/pinax` 仍 **24 文件 / 4,332 行**；`core/**` 未做任何修改；未动 vendor 清单
- 无临时探针/脚本残留；未执行 git 命令；未启停 daemon

LIMITATIONS:
- 工单与设计稿 §6.1 都写「26 个码值」，源文件实测 **25 条**（core 原件同为 25）。测试按 25 条锁定并在注释注明，没有为凑数复制一条不存在的码；`26` 这个数字需要主 agent 更正。
- 与设计稿 §6.1 的「不改 `hostWrite`／`kernelPlumber`（仍经 adapter）」一处偏差：按工单任务 2 改为直取 `src/kernel/`。adapter 确实已导出 `ok/fail/writeFileAtomic/TMP_PREFIX/syncDirectory`，但工单明令「不许再经 adapter 绕道」，且直取可断掉 adapter↔fork 点四角环（设计稿 §5.4 的终态）；S2.4 只针对 `core/**`，不受影响，门禁已验绿。
- `tools/acceptance/acceptance.mjs` 的 `KERNEL_GATEWAY_ALLOW` 仍登记 `src/protocol/hostWrite.mjs`、`src/protocol/kernelPlumber.mjs` 两条已不再 import adapter 的条目（门禁不查腐化，无红）；该文件不在允许改动范围，未动，建议 OS-157 一并清理。
- `src/protocol/README.md` 的叶子件表与 S2.4 说明仍描述「hostWrite/kernelPlumber 经 adapter 转供」；不在允许改动范围，未改。
- `docs/plan/kernel-own-design.md` §6.1 未回写（验收稿只读，偏差已在上条说明）。
- 未执行 git，故无法给出 `git diff`/`git status` 证据，改动清单以上文文件枚举为准。
```

## 验收记录（主 agent 填）

- 2026-11-24 编排器五道门禁全绿（560 例、19 项、水浒 10/10、新建 13/13、vendor 未动、daemon 重启闸生效）；四条红线测试逐个绿（hostWrite 7／decoupleStep3 8／changelog 19／historyRetention 7）；无越界。
- 主 agent 亲验：
  ① **码值逐字未变**——脚本对 `core/pinax/next/kernel/errors.mjs` 与 `src/kernel/errors.mjs` 的键值做字典对比，25 条全部相同；表名已改 `KERNEL_ERROR_CODES`。
  ② `core/pinax` 仍是 **24 文件 / 4,332 行**（影子迁移，本步不删 core）。
  ③ S2.4「内核唯一进口」仍绿（`src/kernel/pinaxAdapter.mjs` 仍是唯一 import `core/**` 的文件）。
  ④ 三件行数核对：errors 55 ＋ atomicWrite 48 ＋ fsDurability 20 ＝ 123 行，与设计稿一致。
- 设计稿据实勘误了两处（已提交）：码值是 **25** 个不是 26 个；`hostWrite`／`kernelPlumber` 实际改为直取 `src/kernel/`（比原设计「仍经 adapter」更干净）。
- 发现两处**待后续收紧**（已并入 OS-153 的任务）：S2.4 的 `KERNEL_GATEWAY_ALLOW` 仍登记着 `hostWrite`／`kernelPlumber` 两条——它们已不再直引 core，允许清单该删（门禁只许更严）；`src/protocol/README.md` 仍写「经 adapter 转供」的旧口径。
- 结论：**已验收**。
