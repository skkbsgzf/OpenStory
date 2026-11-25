# OS-189 · Pinax 残留业务全部退役

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 2 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | **作者裁定（2026-11-25）：「待定里面的几个 Pinax 业务必须全部退役」**；D 批验收记录 §五 D1–D3、§七 第 4／5 项 |
| 依赖 | OS-188a（旧数据键与旧临时文件残留已由升级接管） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`tools/verify/**`、`tools/audit/**`、`skills/README.md`、`LICENSE`、`README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/LEGACY-ITEMS.md`、`docs/workorders/OS-189-pinax-retire.md` |
| 风险 | **中**——删的是兼容分支；每删一处都要有「确认不再被读」的测试顶上 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)（第 13 条是本单的边界）。

## 退役边界（写死）

改完之后，全仓**产品代码**里出现 `pinax`（不区分大小写）的只许是两类：

- (a) `src/protocol/libraryUpgrade.mjs`——一次性升级，作者旧库的出口，必须认得旧名；
- (b) 出处注释（「逐字取自 Pinax-next@70a4f44」这类）与 `README` 致谢段、`docs/`——作者裁定出处声明保留。

其余一律清零。谱系名门禁的整文件豁免取消，改成逐文件逐行白名单，只许 (a)(b) 两类。

## 现状（监督线验收实测，逐处）

1. **首启院子克隆**：`src/modules/storage/courtyard.mjs:14-89`（`LEGACY_COURTYARD_DIR`、`MIGRATION_MARKER`、`MIGRATION_SPEC`、`ensureCourtyard` 的拷贝分支与 console 输出）；`src/host/courtyard.mjs` 的注释。
2. **库清单旧形状读**：`src/modules/storage/libraryManifest.mjs`——`LEGACY_MANIFEST_FILE`（:19）、`normalizeLibraryManifest` 的 `recentProjects` 兼容分支（:90-100）与 `legacy:true`（:146-152）、`'imported-pinax'` 归一（:85、:168）、按旧文件名的写保护特判（:159-161）。
3. **导入适配器直接拿旧目录名判项目**：`src/modules/library/importAdapter.mjs:356-358`；注释 :18-20、:306。
4. **运行时回收旧临时文件前缀**：`src/kernel/atomicWrite.mjs:13`（`LEGACY_TMP_PREFIX`）与 `recoverInterruptedWrites`。
5. **注释里的旧组织名**：`src/modules/deduce/engine/index.mjs:10`（`pinaxAdapter.deduce`）。
6. **`LICENSE:9-10`**：仍写「`core/` 目录下的底座模块逐字 vendor 自 Pinax-next（见 `core/VENDORED.md`）」，目录与文件都已不存在。
7. **过时指引**：`skills/README.md:23-24`、`public/scriptFact.mjs` 的注释还指着 `core/pinax`；谱系门禁 `tools/verify/verify-os172-naming.mjs:11-35` 给它们开了白名单，另有 8 个整文件豁免（`COMPATIBILITY_FILES`）。
8. **审计脚本**：`tools/audit/audit-artifacts.mjs:116`、`tools/audit/audit-sync.mjs:81` 仍写 `.pinax/ui-state.json`。
9. **测试夹具**：`test/modulePlugins.test.mjs` 等用 `{ recentProjects: […] }` 当库清单夹具；`test/files.test.mjs:72-76`、`test/artifacts.test.mjs`、`test/contracts.test.mjs` 用 `.pinax` 当隐藏目录；`test/agent.test.mjs:490,494` 的夹具正文里带旧产品名。

## 任务

1. **院子**：`ensureCourtyard` 只负责「新院不存在就建」，不认旧院、不写标记、不输出迁移日志；`LEGACY_COURTYARD_DIR`、`MIGRATION_MARKER`、`MIGRATION_SPEC` 删除。已经存在的标记文件不读、不删。
2. **库清单**：只认 `{ schemaVersion, libraries }` 形状；`recentProjects` 兼容读、`legacy` 字段、`'imported-pinax'`、`LEGACY_MANIFEST_FILE` 全部删除。写保护改成**通用规则**：目标文件已存在、且内容不是本产品清单形状时拒绝覆盖——不认任何旧文件名。
3. **导入适配器**：旧项目判断改成调用 `libraryUpgrade.mjs` 新导出的 `isLegacyLibraryRoot(root)`（旧名只留在迁移器）；提示语不再出现旧目录名（「这已经是一个库，请直接在库清单里打开」）。
4. **临时前缀**：运行时只认 `.openstory-tmp-`；`LEGACY_TMP_PREFIX` 与对应回收分支删除（残留由 OS-188a 的升级归档）。
5. **注释**：`pinaxAdapter` 一类改成出处口径或删除。
6. **`LICENSE`**：把第 9–10 行换成下面这段事实陈述。**只换这两行**——上面的版权行、使用范围、免责声明与其余条文一个字不动。上游许可名称施工前到 `D:\Pinax-next\LICENSE` 与 `D:\Pinax-core` 的许可文件核一次，照实写；核不到就在回报里说明，不许猜。

   ```
   本软件的内核部分最初逐字取自 Pinax-next（分支 feat/pinax-electron-next，提交 70a4f44；其上游按
   PolyForm Noncommercial License 1.0.0 授权），现已全部转为 OpenStory 自持实现；逐文件出处见
   docs/kernel-provenance.md。上述来源代码原有的版权与许可归属，不因本文件而改变。
   ```

7. **过时指引**：`skills/README.md`、`public/scriptFact.mjs` 指向现在的位置；谱系门禁里对应的白名单条目删掉。
8. **审计脚本**：路径改成 `.openstory/ui-state.json`。
9. **测试夹具**：清单夹具换成本产品形状；隐藏目录夹具换成 `.openstory`；夹具正文换成中性文字。例外：`libraryUpgrade` 的测试，以及「确认旧名不再被读」的反向守卫测试（`test/contracts.test.mjs`、`test/libraryManifest.test.mjs` 里那几条）保留。
10. **反向守卫测试补齐**（临时 `LOCALAPPDATA`）：
    - 旧院目录在、新院不在：启动后新院是空的，旧院目录逐字节不变，没有标记文件；
    - `{ recentProjects: […] }` 形状：回空清单＋`PREFERENCES_SHAPE` 警告，不写回；
    - 目标文件存在且不是本产品形状：拒绝覆盖，原文不变；
    - 源目录带旧运行态目录：导入被拒，错误信息里没有旧目录名；
    - 运行时不再清理旧前缀的临时文件（由升级负责）。
11. **文档同步**：`README.md` 数据位置段（删「旧院冻结、只作历史迁移源」）、`AGENTS.md` 落盘表、`ARCHITECTURE.md`、`docs/LEGACY-ITEMS.md`（补一条「与 Pinax 的运行时关联已全部退役」，列明本单删了什么）。顺手去掉 `src/host/authorize.mjs` 文件尾的多余空行（`git diff --check` 目前唯一一处红）。
12. **谱系名门禁收紧**：`COMPATIBILITY_FILES` 整文件豁免取消；`PROVENANCE_LINES` 改成逐文件逐行的出处白名单；`src/protocol/libraryUpgrade.mjs` 单独列为「一次性升级」。反证两则：(a) 临时在任意 `src/` 文件里写一个 `pinax_xxx`，门禁红；(b) 临时在 `libraryUpgrade.mjs` 之外写旧目录名常量，门禁红。贴输出后还原。

## 不做

- 不动 `src/protocol/libraryUpgrade.mjs` 里的旧名（除新增 `isLegacyLibraryRoot` 导出）。
- 不删出处注释、`README` 致谢段、`docs/kernel-provenance.md`。
- 不碰作者真库与真实 `%LOCALAPPDATA%`（包括那个已经存在的迁移标记文件）。
- 不改端点路径与 MCP 工具名；不改 `LICENSE` 的许可条款。

## 验收

- 机器门禁全绿；红线测试 `test/courtyard.test.mjs`、`test/libraryManifest.test.mjs`、`test/contracts.test.mjs`、`test/decoupleStep1.test.mjs`、`test/os172Naming.test.mjs`、`test/kernelPlumber.test.mjs` 全绿。
- `grep -rni pinax src public genres skills suites package.json` 的全部命中逐行贴进回报，且每一行都属于 (a)(b) 两类。
- 任务 10 的五条反向守卫测试与任务 12 的两则反证，贴输出。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 812 · pass 810 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED: 以下 57 个文件（均在工单「允许改动」范围内）
- AGENTS.md
- ARCHITECTURE.md
- LICENSE
- README.md
- docs/LEGACY-ITEMS.md
- skills/README.md
- src/api/contracts.mjs
- src/api/handlers/library.mjs
- src/host/authorize.mjs
- src/host/courtyard.mjs
- src/host/daemon.mjs
- src/host/libraryManage.mjs
- src/kernel/atomicWrite.mjs
- src/modules/deduce/engine/index.mjs
- src/modules/library/importAdapter.mjs
- src/modules/storage/courtyard.mjs
- src/modules/storage/libraryManifest.mjs
- src/protocol/README.md
- src/protocol/libraryUpgrade.mjs
- test/agent.test.mjs
- test/agentFixtureGuard.test.mjs
- test/agentRuntimes.test.mjs
- test/artifacts.test.mjs
- test/artifactsModule.test.mjs
- test/chapters.test.mjs
- test/config.test.mjs
- test/contracts.test.mjs
- test/coreModules.test.mjs
- test/courtyard.test.mjs
- test/daemonSingleInstance.test.mjs
- test/decoupleStep1.test.mjs
- test/deduceAssets.test.mjs
- test/deduceTurn.test.mjs
- test/dshBridge.test.mjs
- test/exchange.test.mjs
- test/fact-curve.test.mjs
- test/fact-entries.test.mjs
- test/files.test.mjs
- test/genres.test.mjs
- test/habitsModule.test.mjs
- test/historyRetention.test.mjs
- test/kb-health.test.mjs
- test/kernelPlumber.test.mjs
- test/libraryManifest.test.mjs
- test/modulePlugins.test.mjs
- test/originGuard.test.mjs
- test/os172Naming.test.mjs
- test/runtimes.test.mjs
- test/skills.test.mjs
- test/styles.test.mjs
- test/suites.test.mjs
- test/textCapability.test.mjs
- tools/acceptance/acceptance.mjs
- tools/audit/audit-artifacts.mjs
- tools/audit/audit-sync.mjs
- tools/verify/verify-newproj.mjs
- tools/verify/verify-os172-naming.mjs

VERIFIED:
- `npm test`：`tests 812 / pass 810 / fail 0 / skipped 2`。
- `node tools/acceptance/acceptance.mjs`：`验收门禁：27 过 / 0 挂 / 0 警`。
- 红线 `node --test test/courtyard.test.mjs test/libraryManifest.test.mjs test/contracts.test.mjs test/decoupleStep1.test.mjs test/os172Naming.test.mjs test/kernelPlumber.test.mjs`：`tests 60 / pass 59 / fail 0 / skipped 1`。
- 任务 10 五条反向守卫（`--test-name-pattern`）逐条输出：
'''
✔ 旧院在、新院不在：新院空、旧院逐字节不变、没有标记文件、不输出迁移日志 (6.8921ms)
✔ planImport：源目录不存在 / 目标不是项目 / 源带旧运行态目录都拒绝且提示不露旧名 (25.2485ms)
✔ recoverInterruptedWrites 只回收当前前缀；旧前缀残留留给升级归档，绝不误删正文 (6.9054ms)
✔ 反向守卫：旧形状 {recentProjects:[…]} 回空清单＋PREFERENCES_SHAPE，不写回 (9.2846ms)
✔ 反向守卫：目标文件存在且不是本产品形状 → 拒绝覆盖，原文不变（不认文件名） (2.211ms)
ℹ tests 5 / pass 5 / fail 0 / skipped 0
'''
- 任务 12 反证（临时探针写在真实 `src/`，跑完即删，已确认无残留）：
'''
(a) src/__os189_probe.mjs = export const probe = 'pinax_xxx'
"lineage": { "ok": false, "violations": ["src/__os189_probe.mjs:1: export const probe = 'pinax_xxx'"], "scanned": 282 }
GATE_EXIT=1  PROBE_LEFT=no

(b) src/__os189_probe2.mjs = export const LEGACY_DIR = '.pinax'
"lineage": { "ok": false, "violations": ["src/__os189_probe2.mjs:1: export const LEGACY_DIR = '.pinax'"], "scanned": 282 }
GATE_EXIT=1  PROBE_LEFT=no

还原后：{ "ok": true, "violations": [], "scanned": 281 }
'''
- 新机制生产调用点：`src/protocol/libraryUpgrade.mjs:74` 导出 `isLegacyLibraryRoot`，`src/modules/library/importAdapter.mjs:356` 生产调用；`src/modules/storage/courtyard.mjs:19` 的 `ensureCourtyard` 只建新院；`tools/verify/verify-os172-naming.mjs:12,18,86-87` 为「一次性升级单独放行＋逐行出处白名单」。
- `grep -rni pinax src public genres skills suites package.json` 全部 30 行命中（逐行贴出，均属 (a)(b)）：
'''
src/kernel/index.mjs:11: * 谱系：2026-11-24 由 Pinax-next `feat/pinax-electron-next`@`70a4f44` 逐步转自有
src/modules/fact/enrich/metrics.mjs:2: * vendor 自 Pinax-next@devtools/lib/causalMetrics.mjs（2026-11-16 逐字拷贝）。
src/modules/fact/enrich/pseudoChapters.mjs:2: * vendor 自 Pinax-next@devtools/lib/pseudoChapters.mjs（2026-11-16 逐字拷贝）。
src/modules/fact/fact/domain/vocabulary.js:27:  repository: 'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR',
src/modules/library/textUtil.mjs:2:// 谱系：函数体逐字拷贝自 Pinax-next `feat/pinax-electron-next`@`70a4f44` 的
src/modules/library/textUtil.mjs:6:// 原逐字收编自 @pinax/core 0.16.0＝pinax-core e56a0bc）；经协议层叶子转供。
src/modules/storage/projectDoc.mjs:5: * 逐字拷贝归并自 Pinax-next@70a4f44（分支 feat/pinax-electron-next，拷贝方式＝
src/modules/worldbook/worldbookFileContract.mjs:4: * 谱系：2026-11-23 由 @pinax/core 0.16.0（pinax-core 仓 `e56a0bc`）的
src/modules/worldbook/worldbookFileContract.mjs:24: *   解析时再减去 relations[].to 还原 entry.links——对 Pinax 运行时往返无损，
src/modules/worldbook/worldbookFileContract.mjs:26: * - `relations:` 缩进对象列表 [{to,type,stance,covert,weight,src}, ...] = Pinax 富关系。
src/modules/worldbook/worldbookFileContract.mjs:61:/** index.json 指针账本的 list 型 section 顺序（kit init dirs + Pinax 扩展 资料） */
src/protocol/worldbookContract.mjs:6: * 等错误码原样透传）。实现自 OS-157 起为世界书模块自有（此前逐字收编自 @pinax/core
src/services/enrichEngine.mjs:4: * 把 Pinax-next devtools/wiki-enrich-run.mjs 的六槽位管线封装成宿主可调用的引擎：
src/services/enrichEngine.mjs:17: * 溯源纪律（TRACE_HEADER）沿用 Pinax 六槽位口径：章号证据 / 三态置信 / 引用≤40字。
src/protocol/libraryUpgrade.mjs:10:export const LEGACY_PROJECT_SPECS = Object.freeze(['pinax-project@1', 'pinax-project@2', 'pinax-project@3'])
src/protocol/libraryUpgrade.mjs:11:export const LEGACY_WIKI_SCHEMA = 'pinax-wiki-derived@1'
src/protocol/libraryUpgrade.mjs:13:export const LEGACY_CARRIER_PREFIX = 'pinax.carrier.'
src/protocol/libraryUpgrade.mjs:77:  return existsSync(join(resolve(raw), '.pinax'))
src/protocol/libraryUpgrade.mjs:117:  if (head === '.pinax') {
src/protocol/libraryUpgrade.mjs:138:  return key === 'pinaxRelationExtensions' ? 'relationExtensions' : mapStoredPath(key)
src/protocol/libraryUpgrade.mjs:190:    } else if (entry.isFile() && !entry.name.startsWith('.openstory-tmp-') && !entry.name.startsWith('.pinax-tmp-')) {
src/protocol/libraryUpgrade.mjs:198:  const oldMetadata = join(root, '.pinax')
src/protocol/libraryUpgrade.mjs:206:        || text(document?.carriers?.primary).startsWith('pinax.carrier.')
src/protocol/libraryUpgrade.mjs:207:        || (Array.isArray(document?.carriers?.enabled) && document.carriers.enabled.some((id) => text(id).startsWith('pinax.carrier.')))
src/protocol/libraryUpgrade.mjs:399:    const match = /^pinaxRelationExtensions(\s*:)/u.exec(lines[index])
src/protocol/libraryUpgrade.mjs:411:/** OS-188a：把库内 `.pina
```
