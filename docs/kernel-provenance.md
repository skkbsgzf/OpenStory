# 内核出处声明（OpenStory 自有内核）

> **物理内核**（`src/kernel/`，身份 `openstory-kernel@1`）自 2026-11-24 起为 OpenStory 自持实现。
> 其管道件最初逐字取自 Pinax-next 分支 `feat/pinax-electron-next` 提交 `70a4f44`（2026-11-15）；
> fact 词表与校验、写协议、派生层同源，C 批起降为 `src/modules/fact/` 业务内核能力；
> 推演八件亦自该分支平移，现归 `src/modules/deduce/engine/`（产品引擎，不属物理内核）。
> 世界书文件契约最初逐字收编自 `@pinax/core` 0.16.0（pinax-core 仓 `e56a0bc`）。
> OS-152→OS-157 分批转自有后代码在本仓自由演进，**不再与上游同步**。
> 兼容的锚不是代码，是落盘格式：`.pinax/project.json`＝`pinax-project@3`、
> `拆解/*.json`＝`fact.data/v3`、`*.wiki.json`＝`pinax-wiki-derived@1`。

## 一、24 件来源 → 现位置

| # | 上游路径（Pinax-next `70a4f44`） | 现位置 | 转自有批次 |
|---:|---|---|---|
| 1 | `next/kernel/errors.mjs` | `src/kernel/errors.mjs` | OS-152（码值 OS-157 去前缀） |
| 2 | `next/fs/atomicWrite.mjs` | `src/kernel/atomicWrite.mjs` | OS-152 |
| 3 | `electron/projects/fsDurability.mjs` | `src/kernel/fsDurability.mjs` | OS-152 |
| 4 | `next/kernel/factFileStore.mjs` | `src/modules/fact/fact/factFileStore.mjs` | OS-156 |
| 5 | `next/kernel/wikiDerive.mjs` | `src/modules/fact/fact/wikiDerive.mjs` | OS-156 |
| 6 | `next/fact/usecases/factPack.js` | `src/modules/fact/fact/factPack.mjs` | OS-154 |
| 7 | `next/fact/domain/aliases.js` | `src/modules/fact/fact/domain/aliases.js` | OS-153 |
| 8 | `next/fact/domain/schema.js` | `src/modules/fact/fact/domain/schema.js` | OS-153 |
| 9 | `next/fact/domain/stableId.js` | `src/modules/fact/fact/domain/stableId.js` | OS-153 |
| 10 | `next/fact/domain/status.js` | `src/modules/fact/fact/domain/status.js` | OS-153 |
| 11 | `next/fact/domain/validity.js` | `src/modules/fact/fact/domain/validity.js` | OS-153 |
| 12 | `next/fact/domain/vocabulary.js` | `src/modules/fact/fact/domain/vocabulary.js` | OS-153 |
| 13 | `next/fact/domain/perspective.js` | `src/modules/fact/fact/domain/perspective.js` | OS-153 |
| 14 | `next/fact/domain/pediaSchema.js` | `src/modules/fact/fact/domain/index.mjs`（桶改名） | OS-153 |
| 15 | `next/fact/usecases/enrich/pseudoChapters.mjs` | `src/modules/fact/enrich/pseudoChapters.mjs` | OS-154 |
| 16 | `next/fact/usecases/enrich/metrics.mjs` | `src/modules/fact/enrich/metrics.mjs` | OS-154 |
| 17 | `next/fact/usecases/deduce/opening.js` | `src/modules/deduce/engine/opening.mjs` | OS-155 |
| 18 | `next/fact/usecases/deduce/turn.js` | `src/modules/deduce/engine/turn.mjs` | OS-155 |
| 19 | `next/fact/usecases/deduce/settle.js` | `src/modules/deduce/engine/settle.mjs` | OS-155 |
| 20 | `next/fact/usecases/deduce/candidates.js` | `src/modules/deduce/engine/candidates.mjs` | OS-155 |
| 21 | `next/fact/usecases/deduce/fronts.js` | `src/modules/deduce/engine/fronts.mjs` | OS-155 |
| 22 | `next/fact/usecases/deduce/patchChannel.js` | `src/modules/deduce/engine/patchChannel.mjs` | OS-155 |
| 23 | `next/fact/usecases/deduce/sceneContext.js` | `src/modules/deduce/engine/sceneContext.mjs` | OS-155 |
| 24 | `next/fact/usecases/deduce/sessionState.js` | `src/modules/deduce/engine/sessionState.mjs` | OS-155 |

> 第 4–16 件在 C 批从 `src/kernel/{fact,enrich}/` 物理下移到 `src/modules/fact/{fact,enrich}/`，
> 由 `fact` 模块的 `activate` 供给 `fact.store@3`／`fact.pack@1`／`fact.enrich@1`；来源与金样不变。
> 第 15/16 件在上游不存在，是本仓 OS-FACT 批次 `be71a12` 入库后随 OS-154 一并转为自有；
> 表中保留其上游「同目录」口径只为说明谱系，不表示可从上游同步。

另有一件不在 24 件内：

| 上游 | 现位置 | 批次 |
|---|---|---|
| `@pinax/core` 0.16.0 `src/domain/worldbookFileContract.js`（pinax-core `e56a0bc`） | `src/modules/worldbook/worldbookFileContract.mjs` | OS-132 收编 → OS-157 转世界书模块自有 |

## 二、本仓新写、无上游对应的装配件

- `src/kernel/identity.mjs` / `src/kernel/index.mjs`（OS-157）：物理内核身份与 plumber 公开面；C 批明确不再转供业务 fact/enrich。
- `src/modules/deduce/engine/index.mjs`（OS-155）：四个推演端子的模块内出口。
- `src/protocol/factDomain.mjs`（OS-155）：推演引擎取 fact 域原语的协议层转供叶。
- `src/protocol/chapterNumber.mjs`（OS-157）：章节号解析纯函数，从库管理 fork 点上移协议层。
- `src/modules/library/index.mjs`（OS-157）：`projectMeta`／`projectImport` 的模块内组合出口。

## 三、如需与 Pinax 桌面端互认，如何抓夹具（设计稿 §7.2）

互认夹具是**可选项，不是 OS-157 验收项**；本仓当前 `test/fixtures/pinax-desktop/` 不存在，
因此未创建 `test/kernelInterop.test.mjs`。若将来需要证明「读得进桌面端产出的东西」，按下面三件清单抓取：

1. **来源**：由作者用 Pinax 桌面端建一个最小库，录入 2–3 条条目、跑一次 wiki 派生，
   把三个文件拷出——夹具必须是**桌面端真实产出**，不是 OpenStory 生成、不是手写。
   `samples/水浒传` 是本仓样例库，继续当演示库，不当互认锚。
2. **三件**：① `.pinax/project.json`　② `拆解/<bookId>.json`（含 ≥1 worldview、≥1 character、
   ≥1 plot，且带 `validity` 与 `events`）　③ `拆解/<bookId>.wiki.json`。
3. **位置与出处**：固定放 `test/fixtures/pinax-desktop/`（不按日期分目录），同目录附
   `PROVENANCE.json`：`{ capturedAt, desktopVersion, upstreamCommit: "70a4f44", note,
   files: { "<相对路径>": "<sha256>" } }`。

夹具纪律：**只读**——测试一律先 `cp` 到 `mkdtemp` 再写，夹具目录本身永不落新文件；
夹具入仓即测试必跑（不用 `skip: !process.env.X` 软跳）。测试骨架见设计稿 §7.3
（读 project/fact/wiki → tmp 副本写回 → 字段逐项深等 → sha256 与 `PROVENANCE.json` 一致）。

## 四、对外变更

- 错误码旧→新对照见 `docs/error-code-rename.md`。
- 门禁 S2.4 退役为 S2.4'：不再有 vendor 字节锚，`src/**` 不得出现 `core/` 路径说明符；
  互认由 `test/decoupleStep2.test.mjs` 的建库金样与本文件第三节的落盘夹具共同守护。
