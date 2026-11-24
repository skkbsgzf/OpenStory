# OS-157 · 段 B 第 6 步（收尾）：内核转自有的退役与定稿（G9e＋G9f）

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（设计稿 §6.6、§5.3、§7、§4.5） |
| 对应 | 路线 G9e／G9f＋作者裁定 C（错误码要改，本单一次扫净） |
| 依赖 | OS-156 已验收（`ae01987`，`core/pinax` 已归零） |
| 允许改动 | `src/**`、`vendor/**`（**只许整体删除**）、`core/**`（**只许整体删除**）、`scripts/**`、`test/**`、`tools/**`、`package.json`（**只许删 `vendor:check` 脚本与相关 scripts**）、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`PUBLISHING.md`、`.gitignore` |
| 风险 | 高（唯一「回滚即恢复 vendor 纪律」的一步；主 agent 已在提交前备份现场） |
| 状态 | 施工中 |

## 目标

段 B 收尾：`core/` 与 `vendor/` 从仓里消失，vendor 纪律整体退役，`pinaxAdapter` 解散，Host API 定稿 `@2`（五键），
**错误码去掉 `PINAX_` 前缀**（作者裁定 C），补出处声明。

**验收标准（作者 2026-11-24 裁定）**：本轮看的是 **OpenStory 内部代码质量的一次大提升**，不是「用 Pinax 去验 OpenStory」。
互认夹具因此是可选项、不是验收项；既有的金样测试（`decoupleStep2`／`decoupleStep3`）照旧不许动——它们护的是作者既有库的落盘格式。

## 动工前必读

- 设计稿 §4.5（错误码两步改名：本单是第二步「一次扫净」）、§5.3（门禁 S2.4 的三步演变）、§6.6（本单细则）、§7（互认金样）。
- `src/kernel/` 现状（errors／atomicWrite／fsDurability／fact/{factFileStore,wikiDerive,factPack,domain}／enrich）。
- `src/kernel/pinaxAdapter.mjs`（唯一还在为 `projectMeta`／`projectImport` 转供的文件）。
- `vendor/contracts/worldbookFileContract.js`（948 行，OS-132 收编的 @pinax/core 契约）。
- `test/decoupleStep3.test.mjs`（五组出口）、`test/vendorDrift.test.mjs`（16 例，本单删除）、`scripts/vendor-{core,deduce,drift}.mjs`。

## 任务（按顺序做，每步自身可验）

### 1. 世界书契约转自有
`vendor/contracts/worldbookFileContract.js` → `src/modules/worldbook/worldbookFileContract.mjs`（逐字复制，扩展名改 `.mjs`）；
改指向：`src/protocol/worldbookContract.mjs`、`test/decoupleStep1.test.mjs`、`scripts/**` 里的引用；随后删 `vendor/`。

### 2. 解散 `pinaxAdapter`
- 删 `src/kernel/pinaxAdapter.mjs`；
- `src/protocol/{index,kernelPlumber,hostWrite,chapters,factGuard}.mjs` 改直取 `src/kernel/**`；
- `parseChapterNumber` 上移到 `src/protocol/chapterNumber.mjs`（若设计稿 §6.6 如此要求，按它做）；
- `projectMeta`／`projectImport`：由 `libraryManage.mjs`／`chapters.mjs` 直接引模块内文件（模块内组合，S2.1 已允许）。

### 3. Host API `@2` 定稿
`fact` 命名空间定为五键：`enrich`、`factStore`、`fail`、`ok`、`writeFileAtomic`（删 `projectMeta`、`projectImport`）；
同步 `test/hostApi.test.mjs` 的 SNAPSHOT、`src/protocol/index.mjs` 的 JSDoc、`src/protocol/README.md` 能力清单。

### 4. 错误码去 `PINAX_` 前缀（作者裁定 C，一次扫净）
- `src/kernel/errors.mjs` 的 **25 个值**去掉 `PINAX_` 前缀（如 `PINAX_INVALID_ENTRY` → `INVALID_ENTRY`）；
- 逐个核对与 `src/protocol/apiErrors.mjs` 同名码的语义：一致的直接合一，不一致的（如内核 `STALE_REVISION` 与宿主 `REVISION_MISMATCH`）在映射处显式对应；
- `src/protocol/chapterWrite.mjs` 的剥前缀逻辑（`replace(/^PINAX_/u, '')`）已无前缀可剥——简化或删除；
- **全部**测试里的 `PINAX_*` 字面量断言改为新值（`test/decoupleStep3.test.mjs`、`test/factEntriesImport.test.mjs` 等）；
- 本地环境变量改名并**双读兼容一个大版本**：`PINAX_OS_PREFERENCES` → `OPENSTORY_PREFERENCES`、`PINAX_OS_FIXTURE` → `OPENSTORY_FIXTURE`（新名优先、旧名仍认、命中旧名打一次 deprecation 日志）；测试同步；
- 新增 `docs/error-code-rename.md`：**旧码 → 新码对照表**（25 条），供外部调用方（MCP 客户端、脚本）迁移；
- 全仓 `grep -rn "PINAX_" src test tools public scripts docs/ACCEPTANCE.md` 结果贴进报告（应只剩 `docs/plan` 历史记录与本对照表的「旧码」列）。

### 5. vendor 纪律整体退役
删除：`core/`（`VENDORED.md`＋`.vendored-manifest.json`）、`vendor/`、`scripts/vendor-{core,deduce,drift}.mjs`、`test/vendorDrift.test.mjs`；
`package.json` 删 `vendor:check` 脚本；`PUBLISHING.md` 的 VENDORED 段改为「出处见 README 致谢与 `docs/kernel-provenance.md`」。

### 6. 互认夹具（可选，不是验收项）
- **不新增任何会失败、会卡门禁的「等夹具」测试。**
- `docs/kernel-provenance.md` 里留一节「如需与 Pinax 桌面端互认，如何抓夹具」（照设计稿 §7.2 的三件与放置位置写成清单）。
- 只有当 `test/fixtures/pinax-desktop/` **已经存在**时，才按设计稿 §7.3 加 `test/kernelInterop.test.mjs`（先 cp 到 mkdtemp 再写）；不存在就不建这个测试文件。
- 新增 `test/kernelIdentity.test.mjs`：内核身份常量 `openstory-kernel@1` 存在且被 Host API 导出；`src/kernel/` 的公开面逐键锁定（防之后悄悄长出新的耦合）。

### 7. 门禁演变（S2.4 → S2.4'）
`tools/acceptance/acceptance.mjs`：把「内核唯一进口是 adapter」改成「`src/**` 里不许出现 `core/pinax` 字样、`src/kernel/` 是唯一内核实现」；`isProtocolPath` 补 `src/kernel/index.mjs` 若存在。
`AGENTS.md` 硬规则 1／7 的 `core/**`、`vendor/contracts/**` 行换成 `src/kernel/**`；`ARCHITECTURE.md` 分层表删 L2/L3 合并为「自有内核」一层（用 `npm run arch:stats` 回写）。

### 8. 出处声明
新增 `docs/kernel-provenance.md`：内核最初出自 Pinax-next `feat/pinax-electron-next` @ `70a4f44`，OS-152→157 逐步转自有；列出「来源 → 现位置」的对照（24 件）。
`README.md` 致谢段指向它，`PUBLISHING.md` 同步。

## 不做

- 不改 `public/**` 的行为（只有错误码字符串若出现在前端常量里的，跟着改）。
- 不改任何业务逻辑；不动 `package.json` 的 version／dependencies。
- 不删 `samples/`（演示库继续用）。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 598 例；本单会删 `vendorDrift` 16 例、增身份测试——**删除只许是工单点名的那些**，报告里逐个说明）。
- `node tools/acceptance/acceptance.mjs` 全绿（19 项；S2.4' 的措辞变化要说明）。
- `node scripts/arch-stats.mjs --check` 通过（**收尾必做**：`core/` 消失后分层表会变）。
- `core/`、`vendor/` 目录不存在；`grep -rn "core/pinax\|PINAX_" src` 为空（`docs/` 的对照表旧码列除外）。
- **既有金样照绿且未被改动**：`test/decoupleStep2.test.mjs`、`test/decoupleStep3.test.mjs`（`git diff` 里不许出现对它们断言的放宽；码值随裁定 C 改名属合法更新，逐处说明）。
- 水浒 10/10、新建 13/13（主 agent 会复跑）。
- 报告里给出：25 条错误码对照表、`grep` 证据、Host API 五键 SNAPSHOT、互认夹具是否存在（存在才加测试）。

## 纪律

- 既有测试只许新增或等价加强；**只有工单点名的那几个文件可以删**（`test/vendorDrift.test.mjs`），其余一律不许删／skip／放宽。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
