# OS-156 · 段 B 第 5 步：写协议转自有（factFileStore，756 行）——core 清空

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.5） |
| 对应 | 路线 G9d（清单写「等 F2 直测护航 + G7 ADR」——两者早已完成） |
| 依赖 | OS-155 已验收（`f11743f`） |
| 允许改动 | `src/kernel/**`、`src/protocol/**`、`src/services/**`、`test/**`、`tools/acceptance/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`core/**`（**只许删本单点名的 13 个文件并同步清单与说明**） |
| 风险 | 高（写协议核心；全仓 fact 写入的唯一通道） |
| 状态 | 施工中 |

## 目标

最后一块：把 `factFileStore.mjs` 迁进 `src/kernel/fact/`，然后把 `core/pinax/` 剩下的 13 个文件全部删掉——
`core/` 只留 `VENDORED.md` 与 `.vendored-manifest.json`（它们的退役在 OS-157）。

## 动工前必读

- 设计稿 §0.3-1（影子迁移的终点）、§5.1／§5.2、§6.5（本单细则）、§6.7（删除账：本步 core 归零）。
- 源文件 `core/pinax/next/kernel/factFileStore.mjs`（756 行）。
- 现有消费方：`src/kernel/pinaxAdapter.mjs` 的 `factStore` 组、`src/protocol/factGuard.mjs`、`src/api/handlers/{fact,reference}.mjs`、`src/services/{enrichEngine,systemPrompt}.mjs`、`src/modules/worldbook/referenceStore.mjs`、`src/modules/deduce/engine/index.mjs`（间接经 factDomain）。
- **红线金样**：`test/decoupleStep2.test.mjs`（建库金样）、`test/decoupleStep3.test.mjs`（五组出口）、`test/factGuard*.test.mjs`（三定律）、`test/hostWrite.test.mjs`、`test/libraryManage.test.mjs`。

## 任务

1. **迁移** `factFileStore.mjs` → `src/kernel/fact/factFileStore.mjs`：
   - import 改：`./errors.mjs` → `../errors.mjs`；`../fact/domain/pediaSchema.js` → `./domain/index.mjs`；`./wikiDerive.mjs` → `./wikiDerive.mjs`（同目录，确认路径）；其余按实际相对位置改；
   - **一行逻辑都不许改**（这是写协议；任何行为改动都要另立单）。
2. **改指向**：`src/kernel/pinaxAdapter.mjs` 的 `factStore` 组改指新位置；其它消费方若直接 import core 的 store，改经 adapter 或 `src/kernel/fact/factFileStore.mjs`（S2.4 口径：`src/protocol/**` 只许经 adapter／kernel）。
3. **adapter 此时已无 core 可引**：**不许**直接 `export *`——它还要为 `libraryManage`／`chapters` 转供 `projectMeta`／`projectImport`（这两组到 OS-157 才退出）。保持形状不变，只换内部指向。
4. **删除 core 剩余 13 个文件**（store 1 ＋ wikiDerive 1 ＋ domain 8 ＋ 管道 3）：
   - 逐个确认仓内已无 import 指向它们（用 grep 证明，贴进报告）；
   - `core/.vendored-manifest.json` 同步清空（只留 pinaxCore 段那一项对 `vendor/contracts` 的登记——按现状处理并说明）；
   - `core/VENDORED.md` 改成「已全部转自有（OS-152~156）」的现状说明，出处保留。
5. **新增 `test/factWriteProtocol.test.mjs`**（写协议直测，这是本单最重要的产出）：
   - `operationId` 幂等：同 operationId 重放 → `duplicate:true` 且 revision 不涨；
   - `expectedRevision` 冲突 → `PINAX_STALE_REVISION`（本单不改码值）；
   - revision 自增：正常写入一次 +1；
   - 多条目 upsert：按 id 命中替换、没命中追加，顺序稳定；
   - 派生档分离：写 `patch.wiki` 时主档 entries 一字不动、兄弟 `<id>.wiki.json` 更新（读回比对）；
   - 失败路径：非法条目被校验闸拦下时，主档一个字节都不动。
6. **文档**：`npm run arch:stats` 回写（core 归零）；`ARCHITECTURE.md` 的分层表把 `core/` 这一层改成「已退役（见 VENDORED.md）」；`README.md` 的出处与致谢段补一句内核自有的现状（**不改出处事实**）。
7. **`tools/acceptance/acceptance.mjs`**：S2.4 现在会因「没有 core 可 import」而失效或空转——按现状调整（允许清单可清空，或把检查改成「`src/**` 里不许出现 `core/pinax` 字样」）。**只许更严或等价**，并在报告里说明改了什么。

## 不做

- 不改任何码值、不改 Host API 形状（`@2` 定稿在 OS-157）。
- 不删 `core/VENDORED.md` 与 `core/.vendored-manifest.json`、不退役 vendor 漂移脚本（OS-157）。
- 不解散 `pinaxAdapter`（OS-157）。
- 不动 `public/**`、`vendor/**`、`package.json`；不引依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 591 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（19 项，只增不减；S2.4 的调整要说明）。
- `node scripts/vendor-drift.mjs check` 退出 0。
- `node scripts/arch-stats.mjs --check` 通过。
- **金样照绿**：`test/decoupleStep2.test.mjs`（逐字段冻结）与 `test/decoupleStep3.test.mjs` 必须过——这是与 Pinax 桌面端互认的唯一锚，断了就等于断双壳一稿。
- 报告里给出：`grep -rn "core/pinax" src test tools` 的结果（应只剩 docs 与历史注释）、`core/pinax` 的 `find` 计数（应为 0）、金样测试输出。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **`core/**` 只许删本单点名的 13 个文件并同步清单与说明。**
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
