# OS-172 · A1 去 Pinax 化：库的一次性升级（单态收敛＋目录正名）＋谱系名清扫

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 A 宪法批（工作包 A1「互认拆除」；按作者「三名一致」裁定扩成完整的去 Pinax 化） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3a 第二版（规则与不一致清单）、§3 R1／R14 |
| 依赖 | OS-170（数字锚门禁已就位，文档改动受控） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`skills/**`、`suites/**`、`genres/**`、`samples/**`、`.gitignore`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`package.json`（只许改 `description`／`keywords` 一类元数据与 `scripts`；`author` 按作者裁定改为 `skkbsgzf`；**`version`、依赖不动**） |
| 风险 | **高**（改库的落盘位置与目录名；会迁移作者既有库） |
| 状态 | 已验收（2026-11-25 主 agent 独立完成；未提交，待作者统一提交后回填提交号） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

OpenStory 的库与本机，从里到外不再有 Pinax：运行态只有一个家 `.openstory/`；库内目录叫**前端显示的名字**；落盘的谱系名、对用户说的话、技能与套件里的 Pinax 提法一次清干净。旧库**一次性升级**，作者的库只迁一次。

## 主 agent 核对到的现状（对着 `4d8ad95` 实测）

1. **三层名字不统一**：世界书 ↔ 目录 `参考/`；故事源 ↔ `拆解/`；扮演 ↔ `推演/`。修改日志模块名同理（enrich 也把变更记在「拆解」日志）；「＋」面板里世界书还叫「参考」。
2. **`.pinax` 作为运行态目录**：`src` 约 49 个文件、`test` 32、`public` 6、`tools` 7、`samples` 1。
3. **落盘的谱系名**：`pinax-project@3` 与 `pinax.carrier.*`（`project.json`、`genres/` 7 份体裁、`public/app.js` 的建库缺省值）；派生档 schema `pinax-wiki-derived@1`（`public/scriptFact.mjs`）；临时文件前缀 `.pinax-tmp-`（`src/kernel/atomicWrite.mjs`）。
4. **Pinax 导入通道**：端点 `pinaxListGet`／`pinaxListImport`（`/api/library/pinax-list`、`/api/library/pinax-import`）、`importPinaxLibraries`／`inspectPinaxLibraries`、前端 `state.pinaxImport`／`scanPinaxList`。
5. **对用户说的话还在讲「与 Pinax 共用」**（`public/app.js`）：
   - 约 :734「库清单与 Pinax 共用。」
   - 约 :749「库清单与 Pinax 同一份。」
   - 约 :1999「章节就是 正文/NNN-标题.md 文件，Pinax 里同样可见。」
   - 约 :3614 关于页「它和 Pinax 桌面版看的是同一批库文件：两个入口，一份稿子，改哪边都算数。」

   前两处在库清单自持（OS-167）之后**已经是错话**。
6. **货架内容**：`skills/` 9 份里有 15 处「Pinax」，而且技能提示词引用的是 Pinax 的 MCP 工具名（`pinax_chapter_read`、`pinax_worldbook_list`、`pinax_chapter_save`、`pinax_fact_check`、`pinax_extract_status`），不是 OpenStory 自己的 `openstory_*`；`suites/` 6 处「Pinax」。
7. `src/api/handlers/fact.mjs` 约 :1112 的提示语「先跑抽取（pinax_extract_*）再 enrich」。
8. **署名还是 Pinax**（作者 2026-11-24 晚裁定：署名明确统一用自己的 GitHub 名字，不要「Pinax 作者」）：`package.json` 的 `author`「Pinax 作者（OpenStory 线）」；三个内置套件 `suites/{writing,screenwriting,comicdrama}/manifest.json` 与 `suites/PROTOCOL.md` 示例的 `"vendor": "Pinax 官方"`；两份技能头的 `vendor: Pinax 官方`；`test/suites.test.mjs`、`test/pluginGovernance.test.mjs` 里有夹具与断言钉着「Pinax 官方」。

## 任务（可按 A–E 分多次提交，每次提交后全量测试必须绿）

### A. 单态收敛与目录正名

1. 运行态读写全部改到 `<库>/.openstory/`；**读侧只认 `.openstory/`**，不做长期双读。
2. **目录正名（三名一致）**：`参考/` → `世界书/`（与原 `世界书/` 目录合一）、`拆解/` → `故事源/`、`推演/` → `扮演/`；修改日志模块名、「＋」面板里的叫法同步改成前端名称；命名表里 `reference` 并入 `worldbook`，一个正名只留一个 slug；页签「产物」的页面标题「产物中心」改「产物」；「导入导出」的落盘目录名一并对齐板块名。

### B. 落盘的谱系名

3. `project.json` 改用 OpenStory 自己的 spec 名与载体 id（**先在命名表登记，再改代码**）；读到旧名即视为待升级的旧库。
4. 派生档 schema `pinax-wiki-derived@1` 换成自己的版本串（读侧兼容旧串一个大版本，写出只用新串）。
5. 临时文件前缀 `.pinax-tmp-` 换成 `.openstory-tmp-`；清理逻辑**同时认得旧前缀**（以前崩溃留下的残留文件要能被扫掉）。
6. `genres/` 里的载体 id 同步换成新名。

### C. 一次性升级迁移（把 A、B 的变化一次做完）

7. 打开「带旧目录名、或带 `.pinax/`、或 `project.json` 是旧 spec 名」的库时触发：
   - 先把整库相关部分备份到 `<库>/.history/upgrade-<时间戳>/`；
   - 再经物理写管道完成目录改名、运行态迁移、`project.json` 与派生档的谱系名改写；
   - 写迁移标记（时间、做了哪几项）；幂等；
   - **任何一步失败都原样保留并如实报错，绝不留半迁状态**；成功后旧目录改名留档（加 `.retired-<时间戳>` 后缀），不删。
8. 同名冲突（如 `参考/` 与 `世界书/` 里有同名文件）：加后缀并入报告。

### D. 清扫与退役

9. Pinax 导入通道退役：两端点、协议层函数、前端状态与设置页入口下线；契约与端点计数同步。
10. 对用户说的话改成事实（现状第 5 条的四句）。
11. 技能与套件内容：**只替换产品称呼与 MCP 工具名**——`pinax_*` 换成 OpenStory 自己对应的 `openstory_*`（先核对工具确实存在；没有对应的保留原词，并在报告里逐条列出）。不改技能的写法指导本身。
12. 提示语「先跑抽取（pinax_extract_*）」改成 OpenStory 自己的工具名或中性说法。
13a. **署名统一为 `skkbsgzf`**（仓的 git 身份是 `skkbsgzf <59155174+skkbsgzf@users.noreply.github.com>`）：`package.json` 的 `author` 改成 `"skkbsgzf <59155174+skkbsgzf@users.noreply.github.com>"`（与 git 身份逐字一致）；套件与技能里的 `vendor: Pinax 官方` 改成 `skkbsgzf`；`suites/PROTOCOL.md` 示例同步；相关测试夹具与断言跟着改（这是被改的东西本身，属合法更新，逐处说明）。`LICENSE` 的版权人行「Copyright (c) 2026 OpenStory 作者与贡献者」改为「Copyright (c) 2026 skkbsgzf」——**只换版权人名字，许可条款一个字不动**。
13. 样例库 `samples/水浒传` 用生成脚本重跑成新布局（现在同时有 `.openstory` 与 `.pinax`，且还是旧目录名）。

### E. 文档

14. `AGENTS.md` 第 10 条落盘表、`ARCHITECTURE.md`、`README.md` 的数据位置段。
15. `DEMO.md` 的三库口径改为只留《水浒传》（新 demo 从 0 重建是另一个优先级最低的项目，这里只改口径）；`docs/plan/` 里三份 Pinax 对标文档顶部标「历史」。
16. `docs/LEGACY-ITEMS.md`：删「用 Pinax 桌面端打开 OpenStory 新建库确认」；补一条已裁定「互认已拆除、目录已正名」，写明推翻了 OS-48／OS-50（目录名不动）与第二批 G8b（`参考/` 冻结）。
17. **出处声明保留**：`README.md` 致谢段与 `docs/kernel-provenance.md` 里「内核最初出自 Pinax-next」是出处，不是关联，不许删。

## 不做

- **绝不碰作者真库**（`D:/Projects/**`）：迁移只在临时夹具库上验证；作者真库由作者用新版第一次打开时升级。
- 不删任何旧数据（只备份、改名留档）；不保留 `.pinax` 的长期双读。
- 不改端点路径与 MCP 工具名（对外契约名，作者裁定不在三层之内）。
- 不改 `LICENSE` 的许可条款；不新建 demo。

## 验收

- **迁移测试**（临时夹具旧库）：升级后三个新目录名在、`.openstory/` 在、`project.json` 与派生档是新名、旧目录已改名留档、`.history` 有备份、重复打开幂等、逐步注入失败都原样保留、同名冲突加后缀入报告。
- **三名一致门禁**（验收新增）：每个模块的显示名 ＝ 其页签或入口的显示名 ＝ 库内目录名（有目录的）＝ 修改日志模块名；命名表一个正名只许一个 slug。
- **谱系名门禁**（验收新增）：`src/**`、`public/**`、`genres/**`、`skills/**`、`suites/**`、`package.json` 的署名与归属字段里，除出处声明与迁移代码里的旧路径常量外，不许出现 `pinax`（不区分大小写）。
- 反证两则：临时把某目录名改回旧名、临时在某个源文件里写一个 `pinax_xxx`，两道门禁都必须红；贴输出后还原。
- 全量测试与验收门禁全绿；水浒／新建两条 e2e 全绿。
- 报告贴：影响面清单（逐类逐文件）、新旧目录对照、迁移测试输出、四句文案的改后原文、技能里无法替换的 Pinax 工具名清单。

## 本单专属纪律

- 迁移逻辑的每一个分支（成功／幂等／每一步失败／同名冲突）都要有测试。
- **作者已确认（2026-11-24 晚）**：互认拆除、三个目录改名、真库一次性迁移（默认由新版首次打开库时触发）。主 agent 派发前先打一份 git bundle 备份。

## 施工回报（主 agent 独立完成）

CHANGED:

### A. 命名、契约与库升级

- `public/views/registry.mjs`：`reference` 并入 `worldbook`；四名一致；登记 `libraryStorage` 的 `.openstory`、`openstory-project@4`、`openstory.carrier.*`、`openstory-wiki-derived@2`、`.openstory-tmp-*`。
- `src/protocol/libraryUpgrade.mjs`（新增）：旧库识别、备份、inverse journal、逐项迁移、冲突后缀、retired 留档、失败回滚、幂等与进程内串行。
- `src/host/daemon.mjs`、`src/api/handlers/library.mjs`、`src/modules/library/{libraryManage,projectDoc,index}.mjs`：daemon 授权 root 后先升级；新库骨架与 carrier 派生；诊断返回升级报告；失败信封为 `LIBRARY_UPGRADE_FAILED`。
- `src/api/contracts/library.mjs`、`src/api/contracts.mjs`、`src/protocol/{libraryManifest,index,modules}.mjs`、`src/modules/library/module.manifest.json`：退役 `pinaxListGet`／`pinaxListImport` 与旧清单扫描、导入函数和设置入口；端点 107→105，宿主域端点 2→0。

### B. 运行态、目录与谱系名

- `src/protocol/{libState,changelog,syncCheck,authorize,chapterWrite,chapters,hostWrite}.mjs`：ui-state、drafts、log、sync-state、授权保留目录与写通道统一走 `.openstory/`。
- `src/kernel/{atomicWrite,errors}.mjs`、`src/kernel/fact/{factFileStore,wikiDerive}.mjs`：新临时前缀同时回收旧前缀；fact 目录为 `故事源/`；新派生档写 `openstory-wiki-derived@2`，旧 `pinax-wiki-derived@1` 读兼容。
- `src/modules/worldbook/{referenceStore,worldbookFileContract}.mjs`、`src/modules/deduce/{deduceSession,deduceEngine,deduceNarrative}.mjs`、`src/api/handlers/{exchange,fact,reference}.mjs`：世界书、故事源、扮演与导入导出路径正名。
- `src/services/{enrichEngine,factBooks,factImportWrite,syncCheck,systemPrompt,skills,uiPreferences}.mjs`：消费新目录、schema、carrier 与日志模块名。
- `src/api/contracts/{chapters,exchange,fact,reference,system}.mjs`、`src/protocol/{factGuard,README}.mjs`：错误与提示语同步新口径。
- `genres/{feature-film,literary,long-serial,short-drama,short-story,tv-series}.json`、`genres/PROTOCOL.md`：carrier 改为 `openstory.carrier.*`。

### C. 前端与对用户文案

- `public/app.js`、`public/index.html`：移除 Pinax 清单导入 UI、state 与函数；新 carrier 缺省值；四句事实文案；`app.js` 11,886→11,838 行。
- `public/views/{registry,chapterLoad,deduceViews,referenceViews,settingsAggregation,workbenchViews}.mjs`：页签、抽屉、设置与产物页正名；产物标题为 `产物`。
- `public/{analysisModules,charts,graph,reference,referenceStore,scriptFact,storySource}.mjs`：空态、图例、路径、schema 与提示语同步。

### D. 技能、套件与署名

- `skills/PROTOCOL.md`、`skills/{chapter-rewrite,continuity-check,de-ai-writing,fact-consistency,fact-extract,outline-restructure,scene-expand,screenplay-craft,storyboard-craft,worldbook-refactor}/SKILL.md`：产品称呼与确有的 OpenStory MCP 工具名更新，写法指导不改。
- `suites/PROTOCOL.md`、`suites/{comicdrama,screenwriting,writing}/manifest.json`、两个 suite skill：vendor 统一 `skkbsgzf`。
- `package.json`、`LICENSE`：author 与版权人统一为作者裁定身份；许可条款未改。
- `README.md`、`docs/kernel-provenance.md`：真实上游出处声明保留；其他内容来源署名未删除。

### E. 门禁、测试、样例与文档

- `tools/verify/verify-os172-naming.mjs`、`test/os172Naming.test.mjs`（新增）：四名一致与谱系名门禁、内存反例、真实仓扫描。
- `tools/acceptance/acceptance.mjs`：新增 S2.9／S2.10；S3.4 用 `.openstory/ui-state.json`；S3.6 含 untracked 样例；S4.1 夹具目录改从命名表派生，修复正名后的误报。
- `tools/acceptance/importScan.mjs`：登记 `referenceStore.mjs → views/registry.mjs` 的只读命名真源边，并说明不形成模块耦合或循环依赖。
- `test/libraryUpgrade.test.mjs`（新增）：成功、幂等、新布局直通、旧目录-only、22 个失败注入点、坏 project、JSON／JSONL 路径冲突、并发串行。
- `test/{contracts,libraryManifest,libraryManage,newLibrarySkeleton,naming,tabRegistry,moduleCoverage,modulePlugins,coreModules,finalAudit}.test.mjs`：契约退役、目录正名、四名一致、端点覆盖与数字锚等价更新。
- `test/{libState,changelog,syncCheck,hostWrite,kernelPlumber,files,historyRetention,hostApi,writeEndpoints}.test.mjs`：运行态与写通道改走 `.openstory/`。
- `test/{reference,referenceViews,storysourceModule,fact-curve,fact-entries,factEntriesImport,factGuard,enrichPipeline,exchange}.test.mjs`：世界书、故事源与导入导出路径／文案等价更新。
- `test/{deduceEngine,deduceTurn,deduceSession,deduceAssets,deduceDeterminism,agent,artifacts,artifactsModule}.test.mjs`：扮演目录与页面／提示语等价更新。
- `test/{decoupleStep1,decoupleStep2,decoupleStep3,genres,skills,suites,pluginGovernance,styles,sampleConfig}.test.mjs`、`test/fixtures/osE2eBook.mjs`：载体、作者身份、样例与金样输入改新口径，业务断言未放宽。
- 其余 `test/**` 变更为本机路径、错误文案或目录名的等价夹具更新；OS-169 的健壮性改动保持有效。
- `tools/samples/generate-sample-config.mjs`：显式递归复制；用真实升级、ui-state 与 suite API 生成样例。
- `tools/verify/{verify-shuihu,verify-newproj,verify-os172-e2e}.mjs`：新布局真链路；临时 `LOCALAPPDATA`、临时 loopback 假上游；清理测试库与偏好。
- `samples/水浒传/`：重生成 `.openstory/`、`世界书/`、`故事源/`、`扮演/`；移除旧 `.pinax/`、`参考/`、`拆解/`、`推演/`、`导出/` 与迁移残留。
- `AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`docs/{ACCEPTANCE,DEMO,LEGACY-ITEMS,PUBLISHING}.md`、`src/protocol/README.md`、三份历史规划、`docs/plan/{final-audit,workorder-system-20261124}.md`、`docs/workorders/{BOARD,COMMON-RULES,HANDOFF}.md`：落盘表、示例、历史冻结被 OS-172 取代、退役说明与最终数字锚同步。

### 新旧目录与格式对照

| 旧 | 新 | 兼容策略 |
|---|---|---|
| `.pinax/` | `.openstory/` | 首次打开旧库时一次性迁移；成功后不长期双读 |
| `参考/` | `世界书/` | 两目录合一；同名冲突加 `.upgrade-<时间戳>` |
| `拆解/` | `故事源/` | 目录及 JSON／JSONL 内部路径一并迁移 |
| `推演/` | `扮演/` | 会话、归档、导出、素材路径一并迁移 |
| `导出/` | `导入导出/` | 新导出统一落新目录 |
| `pinax-project@1/2/3` | `openstory-project@4` | 旧 spec 触发升级；新库 schemaVersion 4 |
| `pinax.carrier.*` | `openstory.carrier.*` | 旧 carrier 触发升级 |
| `pinax-wiki-derived@1` | `openstory-wiki-derived@2` | 旧 schema 读兼容一个大版本，只写新 schema |
| `.pinax-tmp-*` | `.openstory-tmp-*` | 新写使用新前缀，回收同时识别旧前缀 |
| 成功后的旧目录 | `.retired-<时间戳>/` | 不删除；整库相关部分另有 `.history/upgrade-<时间戳>/` 备份 |

### 四句文案改后原文

1. 新建一个库（挑主模块建骨架），或把已有的稿子目录导入进来。库清单由 OpenStory 自己维护。
2. 每个库就是磁盘上的一个文件夹，库清单只属于 OpenStory。
3. 左侧点章节载入；或输入标题新建一章（自动编号）。章节就是 正文/NNN-标题.md 文件，所有修改都在本机留备份与日志。
4. OpenStory 是给写小说用的本地工作台。稿件、草稿、会话与密钥都只留在本机，所有修改都有备份与日志，不上传也不联网同步。

### 无等价 OpenStory 工具、未伪造改名的旧 MCP 工具

以下旧名不属于 OpenStory 当前 24 工具契约，已从产品技能使用说明移除，只在本审计记录保留原名：

- `pinax_fact_check`
- `pinax_extract_status`
- `pinax_extract_finish`
- `pinax_extract_prepare`
- `pinax_extract_next`
- `pinax_extract_submit`
- `pinax_outline_read`
- `pinax_outline_save`
- `pinax_chapter_save`
- `pinax_worldbook_save`
- `pinax_project_context`

VERIFIED:

- `node --test test/libraryUpgrade.test.mjs test/os172Naming.test.mjs test/importScan.test.mjs` → **18/18 通过**：迁移 9／命名与谱系 3／依赖边 6；含 22 个迁移失败注入点与 JSON／JSONL 冲突回滚。
- `node --test test/*.test.mjs` → **702 tests / 700 pass / 2 skip / 0 fail**。
- `node tools/number-anchors.mjs` → 回写成功；`--check` 全绿。当前为 27 门禁、105 端点、41 模块独占端点、64 宿主自有端点、0 宿主域端点、90 测试文件、`app.js` 11,838≤11,886 行。
- `node tools/acceptance/acceptance.mjs` → **27 过 / 0 挂 / 0 警**；S2.9 四名一致 21 概念，S2.10 扫描 205 文件。
- `npm run arch:stats && npm run arch:check` → 生成段回写且逐字一致。
- `node tools/verify/verify-ci-workflow.mjs` → Node 24／两轮测试／验收／arch check／失败产物结构通过。
- `node tools/verify/verify-os172-e2e.mjs` → 《水浒传》**10/10**、新建/半成品 **13/13**；扮演开场 52 字、3 分支；临时库与临时院子清理完。
- `git diff --check` → 通过（只有 Git 的 LF→CRLF 转换提示，无 whitespace 错误）。

### 两道真实门禁反例（均已还原）

1. 临时把 `public/views/registry.mjs` 的 worldbook 页签名改回 `参考`：

```text
worldbook: 目录与页签/入口名不一致
src/modules/worldbook/module.manifest.json: 模块显示名不一致
```

还原后 registry sha256：`db96aff38ca8db219a76c9f8711bc8ea523b59bd26c757e3621ce53396a750eb`。

2. 临时创建 `public/__os172_lineage_counterexample.mjs`，内容为 `export const unmatchedLegacyTool = 'pinax_xxx'`：

```text
public/__os172_lineage_counterexample.mjs:1: export const unmatchedLegacyTool = 'pinax_xxx'
```

探针已删除；恢复后 naming／lineage 均 `ok:true`、`violations:[]`。

### 浏览器窄屏实测

- 使用受控后台临时 Node 进程持有 daemon，只监听临时 loopback 端口 62008；同源 iframe 模拟宽度，结束后关闭页面、停止进程并删除临时库。
- 675px：body `clientWidth=675`／`scrollWidth=675`；页签可横滑；正文无横向溢出；世界书、故事源、扮演、产物均可打开，产物标题为 `产物`。
- 420px：body `clientWidth=420`／`scrollWidth=420`；页签 `clientWidth=420`／`scrollWidth=614`／`overflow-x:auto`；正文 `clientWidth=410`／`scrollWidth=410`；世界书抽屉 248px、分析抽屉 300px，未裁切。
- 临时 host 脚本、截图、iframe 与临时库均已删除；复验 `http://127.0.0.1:62008/api/health` 不可达。

LIMITATIONS:

- 未碰作者真库与真实 `%LOCALAPPDATA%`；作者真库的一次性升级报告仍需作者首次打开时确认。
- 未执行 commit、push、PR；GitHub Actions 远端首跑待提交推送后进行。
- 不保留 `.pinax/` 长期双读；旧数据只通过一次性迁移、备份与 retired 留档兼容。

## 验收记录（主 agent 填）

- 2026-11-25：主 agent 独立审查实现与测试，确认迁移成功／幂等／冲突／失败回滚都有覆盖；旧数据不删除；读侧无双读；对外端点与 MCP 工具名除明确退役的两端点外未改。
- 反证、675/420 浏览器验收、全量测试、27 项验收、数字锚、架构统计、CI 结构与两条临时 e2e 均通过。
- 结论：**OS-172 已验收**；待作者统一提交后回填提交号。下一步为 OS-173 的 ADR 0002、`module-manifest@2`、三名一致表与 R1–R14 处置。
