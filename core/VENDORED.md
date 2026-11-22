# VENDORED — 底座抽取层出处

`core/pinax/` 下的 49 个文件**逐字 vendor** 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness)
分支 `feat/pinax-electron-next`，提交 `70a4f44`（2026-11-15）。抽取方式＝递归追 import 闭包
（`scripts/vendor-core.mjs`），内部相对 import 原样保留——**这些文件在本仓不改**；
改动应发生在上游 Pinax-next，然后重跑 vendor 脚本同步。

## 映射

| 本仓 | 上游 |
|---|---|
| `core/pinax/next/**` | `next/**`（kernel/project/shell 底座面＋carriers 载体清单；runtime 导入适配已自持，见 OS-123） |
| `core/pinax/electron/**` | `electron/**`（闭包拉进的 fs 耐久化，被 `next/fs/atomicWrite.mjs` 引用） |
| `node_modules/@pinax/core` | 上游 npm 包 @pinax/core 0.16.0（载体的 domain/usecases 依赖；后续随底座升格处理） |

## 边界

- 载体**清单**（manifest.mjs）随底座走——OpenStory 只用 projectKind/dataDirs/依赖闭包做建库；
  载体**实现**（tools.mjs）不上底座（OpenStory 从不调用，registry.install 的 impl 传空）。
- `@pinax/core` 包是上游 pinax-core 抽包路线的既有产物（core README 禁 monorepo），
  本仓作为消费者依赖；底座升格时按同一模式把 core/pinax/ 逐步上收。


## OS-123 解耦①：server 层移除，章节号与导入自持

server 层（`core/pinax/server/**`，6 文件）与闭包垫片（`core/pinax/shared/**`，2 文件）
已从本仓删除；`core/pinax/next/runtime/projectImportAdapter.mjs` 一并移除。
其能力由本仓自有代码接手（fork 点，不再经 `scripts/vendor-core.mjs` 同步）：

| 本仓自有 | 逐字拷贝自（70a4f44） |
|---|---|
| `textUtil.mjs` 的 `parseChapterNumber` ＋ `CHINESE_DIGITS` | `server/mcp/projectImport.js:39,58-73` |
| `textUtil.mjs` 的 `parseWorldbookEntryFile` ＋ `contractEntryToRuntime` ＋ `worldbookIsPlainObject` ＋ `worldbookStringList` ＋ `WORLDBOOK_DERIVED_SRC` | `server/services/localMirrorService.js:227-236,300-360` |
| `importAdapter.mjs`（整文件） | `next/runtime/projectImportAdapter.mjs` |

世界书契约 v2 判定直接 import `@pinax/core/domain/worldbookFileContract`
（原 `core/pinax/shared/worldbookFileContract.js` 只是两行 re-export 垫片）。
护栏测试：`test/decoupleStep1.test.mjs`。
现存 vendor 文件 53 个；`core/pinax/electron/**` 保留（`next/fs/atomicWrite.mjs:4`
仍引用 `electron/projects/fsDurability.mjs`，无引用后才可删）。

## OS-29 追加（推演引擎）

`core/pinax/next/fact/**`（18 文件）逐字 vendor 自同一提交 70a4f44：

| 本仓 | 上游 |
|---|---|
| `core/pinax/next/fact/usecases/deduce/**` | 推演链：turn / candidates / settle / opening / sessionState |
| `core/pinax/next/fact/usecases/factPack.js` | 事实包投影（局面卡与候选的数据源） |
| `core/pinax/next/fact/domain/**` | aliases / stableId / vocabulary / validity / pediaSchema |

同步方式：改上游 → 重跑 `scripts/vendor-deduce.mjs`（递归闭包，零外部依赖）。
daemon 侧封装在 `deduceEngine.mjs`（引擎确定性：同种子＋同事实包＝同一拍）。
