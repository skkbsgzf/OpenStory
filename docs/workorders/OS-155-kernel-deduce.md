# OS-155 · 段 B 第 4 步：推演链归位（deduce 8 件，1,236 行）＋ Host API 升 @2

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.4、§5.2、§9-3） |
| 对应 | 路线 G9c（清单只列 3 件，另一 5 件是依赖）＋作者裁定 B（推演链归模块） |
| 依赖 | OS-154 已验收（`bc24c3b`）；作者已同意 `host-api@1 → @2` |
| 允许改动 | `src/modules/deduce/**`、`src/kernel/**`、`src/protocol/**`、`src/services/**`、`test/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`core/pinax/next/fact/usecases/deduce/**`（**只许删这 8 件**）、`core/pinax/next/fact/usecases/factPack.js`（**只许删这 1 件**）、`core/.vendored-manifest.json`、`core/VENDORED.md` |
| 风险 | 中偏高（动 Host API 版本；推演是产品引擎，行为必须逐拍不变） |
| 状态 | 施工中 |

## 目标

推演链**不进内核**——它是产品引擎，归扮演模块自己。八件从 `core/` 迁到 `src/modules/deduce/engine/`，`fact.deduce` 从 Host API 退出（`host-api@2`）。
同时把 `llmPort` 从「隐式可选」整理成显式接口。

## 动工前必读

- 设计稿 §5.1（五组出口去向）、§5.2（Host API 承接与版本表）、§6.4（本单细则）、§6.7（删除账：本步删 9 件，core 22 → 13）。
- 8 个源文件：`core/pinax/next/fact/usecases/deduce/` 下的 `opening.js`、`turn.js`、`settle.js`、`candidates.js`、`fronts.js`、`patchChannel.js`、`sceneContext.js`、`sessionState.js`；另删 `core/pinax/next/fact/usecases/factPack.js`（`factPack` 已于 OS-154 转自有）。
- `src/modules/deduce/deduceEngine.mjs`（`:14-18` 引 adapter 的 `deduce` 组；`:205-211` 是 llmPort 的现状）。
- `src/protocol/index.mjs`（`fact` 命名空间与 `HOST_API_VERSION`）、`test/hostApi.test.mjs`（SNAPSHOT 与字面量断言）。
- `src/protocol/factGuard.mjs`（取 fact 域原语的现有路径）。

## 任务

1. **迁移 8 件**到 `src/modules/deduce/engine/`：
   - 扩展名 `.js → .mjs`；
   - 引擎内部相互 import 的相对路径保持不变（同目录平移）；
   - 它们对「fact 域原语」（词表／校验／稳定 id／双时间轴）的依赖，**改从新建的 `src/protocol/factDomain.mjs` 取**（该文件只做 re-export，从 `src/kernel/fact/domain/index.mjs` 转发，不复制实现）；
   - `factPack` 依赖改从 `src/kernel/fact/factPack.mjs` 取。
2. **新建 `src/modules/deduce/engine/index.mjs`**：导出面与今天 adapter 的 `deduce` 组逐个对齐（`openDeduceSession`／`presentTurn`／`applyDirectorAction`／`settleChoice`），导出名一字不改。
3. **改指向**：
   - `src/modules/deduce/deduceEngine.mjs`：改引 `./engine/index.mjs`（模块内直引，符合 S2.1 的模块内组合例外）；
   - 全仓搜还有谁在用 `fact.deduce`（`src/protocol/index.mjs`、测试），逐个改。
4. **Host API 升 `@2`**：
   - 删 `fact.deduce`；
   - `HOST_API_VERSION` 改 `host-api@2`；
   - 同步 `test/hostApi.test.mjs` 的 SNAPSHOT 与字面量（`:34-36,48,65`）、`src/protocol/README.md` 的能力清单、`src/protocol/index.mjs` 的 JSDoc；
   - 确认 `src/protocol/**` 对 `src/modules/**` 的依赖降为 0（设计稿 §5.1 的副产品）。
5. **llmPort 接口显式化**：
   - 现状「有就给、没就空数组」；整理成文档化接口：`propose({ prompt, refs }) → [{ text, refs }] | null`；
   - 在 `deduceEngine.mjs` 里写成显式形状校验（返回不是数组/形状坏 → 视为 null 并如实记录，不炸）；
   - 写进 `docs/`（可以进 `ARCHITECTURE.md` 或 `docs/deduce-llm-port.md`，你选一处并说明）。
6. **删除 core 9 件**：8 个 deduce ＋ `factPack.js`；同步 `core/.vendored-manifest.json` 除名、`core/VENDORED.md` 记一句去向。
7. **新增测试**：
   - `test/deduceDeterminism.test.mjs`：「同种子＋同事实包＝同一拍」逐字段锁（至少两种种子）；
   - `patchChannel` 幂等（同一事件回写两次＝一条）；
   - `fronts` 只进不退；
   - llmPort 三种形态：给了正常实现／返回 null／返回坏形状——行为分别是什么（不得抛）。
8. **文档**：`npm run arch:stats` 回写（core 会降到 13 文件）；`ARCHITECTURE.md` 的分层表把推演链画进「模块」层而不是内核层。

## 不做

- 不改 `factFileStore`（OS-156）；不动 `wikiDerive`／`enrich`／`fact/domain`（已迁）。
- 不动 `public/**`、`vendor/**`、`package.json`；不引依赖。
- **不改任何错误码字符串**（C 的扫净在 OS-157）。
- 不改推演的**行为**：同一会话、同一事实包、同一选择，产出必须与改前逐字相同（用确定性测试证明）。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 582 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（19 项；S2.4 仍绿，且「协议层不依赖模块层」这条若门禁有扫描则一并确认）。
- `node scripts/vendor-drift.mjs check` 退出 0，清单除名 9 项（22 → 13）。
- `node scripts/arch-stats.mjs --check` 通过。
- 报告里给出：8 件行数（1,236）、core 现在 **13 文件**、确定性测试输出、`hostApi.test.mjs` 的 SNAPSHOT 新形状。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言（`hostApi` 的 SNAPSHOT 随版本升级更新属合法）。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- **`core/**` 只许删本单点名的 9 个文件并同步清单。**
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
