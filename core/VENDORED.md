# VENDORED — 底座抽取层出处

`core/pinax/` 下的 24 个文件**逐字 vendor** 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness)
分支 `feat/pinax-electron-next`，提交 `70a4f44`（2026-11-15）。抽取方式＝递归追 import 闭包
（`scripts/vendor-core.mjs`），内部相对 import 原样保留——**这些文件在本仓不改**；
改动应发生在上游 Pinax-next，然后重跑 vendor 脚本同步。
已自持的面（server 层／章节号与导入、建库）见下方 OS-123／OS-124 两节——那些文件删了就删了，
不要用 vendor 脚本拉回。

## 映射

| 本仓 | 上游 |
|---|---|
| `core/pinax/next/fact/**` | `next/fact/**`（事实链底座，见 OS-29；同步走 `scripts/vendor-deduce.mjs`） |
| `core/pinax/next/fs/**`、`core/pinax/next/kernel/{errors,factFileStore,wikiDerive}.mjs` | 同名上游文件（factFileStore 的落盘与派生底座） |
| `core/pinax/electron/**` | `electron/**`（闭包拉进的 fs 耐久化，被 `next/fs/atomicWrite.mjs` 引用） |
| `node_modules/@pinax/core` | 上游 npm 包 @pinax/core 0.16.0（载体的 domain/usecases 依赖；后续随底座升格处理） |
| `projectDoc.mjs`（本仓自有） | 逐字归并自 `next/{kernel/projectSkeleton,project/**,shell/library/wizardKit}`，见 OS-124 |

载体清单（`next/carriers/**`）、载体注册体系（pluginRegistry/carrierManifest 族）、
建库骨架（projectSkeleton/project/**）与建库向导话术（shell/library/wizardKit）已随 OS-124 删除——
建库由本仓 `projectDoc.mjs` 自持，不再 vendor。

## 边界

- 载体**清单**（manifest.mjs）已不随底座走（OS-124 删除）——OpenStory 只用 projectKind/dataDirs/依赖闭包
  做建库，这两样连同 requires 均冻结在 `projectDoc.mjs` 的 CARRIERS 表里（与被删清单逐字一致）；
  载体**实现**（tools.mjs）从来不上底座（OpenStory 从不调用）。
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
OS-123 时现存 vendor 文件 53 个；`core/pinax/electron/**` 保留（`next/fs/atomicWrite.mjs:4`
仍引用 `electron/projects/fsDurability.mjs`，无引用后才可删）。

## OS-124 解耦②：载体注册体系与建库骨架移除，建库由本仓 projectDoc 自持

`core/pinax/next/carriers/**`（11 载体清单）、`core/pinax/next/project/**`、`core/pinax/next/shell/**`、
`core/pinax/next/kernel/` 的 pluginRegistry/carrierManifest 七件套/scopeGrant/capabilities.vocab/
capabilityGraph/projectSkeleton/pluginLoader/declarativeImpl（14 文件）、`core/carrierBootstrap.mjs`、
`core/index.mjs`、`core/pinax/next/fact/usecases/hypothesis.js`（死码，无 import 方）已从本仓删除
（净 -4,922 行 vendor）。其能力由本仓自有代码接手（fork 点，不再经 `scripts/vendor-core.mjs` 同步）：

| 本仓自有（`projectDoc.mjs`） | 逐字拷贝自（70a4f44） |
|---|---|
| PROJECT_SPEC / LEGACY_PROJECT_SPECS / METADATA_DIR / PROJECT_KINDS / isKnownKind / skeletonDirs / allSkeletonDirs / ensureSkeleton | `next/kernel/projectSkeleton.mjs` |
| projectManifest 除 import 外整文件（validate/build/buildBare/normalizeCarriers/nextCarriers/projectMarkerPath/read/writeProjectDocument/PROJECT_DOC_FIELDS） | `next/project/projectManifest.mjs` |
| createProject / initBareProject / prepareRoot / makeMetadataDirs / makeProjectId（除 import 外整文件） | `next/project/createProject.mjs` |
| describeOpenFailure / validateLibraryName / folderName | `next/shell/library/wizardKit.mjs` |
| CARRIERS 表（projectKind/dataDirs 逐字）＋ createRegistry/createCarrierRegistry/resolveClosure（requires 全 [] → 恒等闭包） | 本仓新写；值取自 `next/carriers/{novel,script}/manifest.mjs` |

`.pinax/project.json` 落盘格式是与 Pinax 桌面端的双向兼容契约：spec 'pinax-project@3'、schemaVersion 3、
字段名与顺序、carriers{primary,enabled,revision}——一个字节不许变（金样护栏 `test/decoupleStep2.test.mjs`，
金样＝删除前内核建库输出的冻结值）。仍从 vendor 只读面引：`next/kernel/errors.mjs`、
`next/fs/atomicWrite.mjs`（含 electron fsDurability 的 fsync 链）。
现存 vendor 文件 24 个；`scripts/vendor-core.mjs` 的 SEEDS 表已随删除面过时（重跑会把已删层拉回仓，
不要再跑；底座升格时以 `projectDoc.mjs` 为准）。

## OS-29 追加（推演引擎）

`core/pinax/next/fact/**`（18 文件）逐字 vendor 自同一提交 70a4f44：

| 本仓 | 上游 |
|---|---|
| `core/pinax/next/fact/usecases/deduce/**` | 推演链：turn / candidates / settle / opening / sessionState |
| `core/pinax/next/fact/usecases/factPack.js` | 事实包投影（局面卡与候选的数据源） |
| `core/pinax/next/fact/domain/**` | aliases / stableId / vocabulary / validity / pediaSchema |

同步方式：改上游 → 重跑 `scripts/vendor-deduce.mjs`（递归闭包，零外部依赖）。
daemon 侧封装在 `deduceEngine.mjs`（引擎确定性：同种子＋同事实包＝同一拍）。

## OS-126 解耦④：上游漂移检测（vendor 指纹锚）

`core/**` 的 24 个 vendor 文件有 sha256 指纹锚 `core/.vendored-manifest.json`
（记录 `upstreamCommit=70a4f44` 与逐文件哈希），由零依赖脚本 `scripts/vendor-drift.mjs`
（node:fs/crypto/path）维护：

```bash
node scripts/vendor-drift.mjs snapshot   # 生成/重生成指纹锚
node scripts/vendor-drift.mjs check      # 逐文件比对，漂移 → exit 1
npm run vendor:check                     # 同 check
```

比对三类：本仓当前字节 ≠ 锚 → `[本仓被改]`（vendor 不许在本仓改，改动应发生在上游再同步）；
上游同位置（映射 `core/pinax/<X>` ↔ 上游 `<X>`，next/server/electron 通吃）≠ 锚 → `[上游已变]`
（上游在锚之后动过，该决定是否重同步）；core/** 下长出锚外新文件 → `[清单缺项]`（锚过时，
重跑 snapshot）。三者任一非空 exit 1。上游已无此文件＝本仓有意删除（如 OS-123 的 server 层）
→ `[跳过]`，不计漂移。护栏测试：`test/vendorDrift.test.mjs`（临时目录喂纯函数，不碰真 core/）。

注意三点：① 哈希是**原始字节**级（两仓都以 CRLF 检出、逐字节拷贝，当前逐字节同源）——
若一侧行尾策略改变会误报，届时以归一化比对人工复核；② 锚不含清单自身与本文档
（本仓自有文档，随解耦批次正常追加，不算「本仓被改」）；③ 基线里
`enrich/{metrics,pseudoChapters}.mjs` 两文件上游（含 70a4f44）无对应文件，check 恒 `[跳过]`
——它们随本仓 OS-FACT 批次（be71a12）入库，上游全历史（`git log --all` 该路径为空）
与工作树均无此文件，从未收编；上游若收编同名文件，锚不会比对到（需重跑 snapshot 入锚）。
