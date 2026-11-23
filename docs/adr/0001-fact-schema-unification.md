# ADR 0001 · G7 数据源归一——统一成 fact（合并路线）

**状态：已裁定（作者 2026-11-23）：统一成 fact——合并路线。** 本文是裁定记录与后果梳理，不是待决草案。

> **裁定原文（作者，2026-11-23）**：「数据源统一成 fact，本质是相同的。」
>
> 释义（按裁定执行的理解，非新增决定）：fact.data（当前 v3、legacy v2）是唯一事实 schema；
> pedia/v1（NovelPedia）本质相同，按同一事实链对待；OpenStory 与 NovelPedia 之间的导入导出一律走 fact.data/v3。

---

## 一、背景与术语

| 术语 | 本文含义 |
|---|---|
| **fact／事实链** | OpenStory 的一级公民：`<库>/拆解/<bookId>.json` 里的结构化条目（事件/人物/设定/关系），FACT-FIRST 声明它是唯一结构化读取通道（`FACT-FIRST.md` §一、§三规则1）。 |
| **fact.data/v3** | 条目契约当前版本（`core/pinax/next/fact/domain/vocabulary.js:21` `FACT_SCHEMA`）。 |
| **legacy v2** | 历史版本，读兼容不迁移（`vocabulary.js:24` `FACT_SCHEMA_LEGACY`；v2 条目读进来按 events 重建缺失字段）。 |
| **pedia/v1（NovelPedia）** | fact 词表的上游出处：NovelPedia 的 `src/pedia_schema.json`（commit eb4f140…）。出处注记见 `vocabulary.js:26-32`（`FACT_SOURCE.repository = 'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR'`）。 |
| **派生层（wiki）** | 六槽位/因果图/需求层级/状态台账等 enrich 产物，落兄弟文件 `<bookId>.wiki.json`；FACT-FIRST 口径：派生层「也是事实链的一部分」（`FACT-FIRST.md:39-48`）。 |
| **scriptFact** | 剧本↔fact 双向互转（`public/scriptFact.mjs`，OS-78），是仓内唯一的双向转换（`docs/AUDIT-ARTIFACTS.md:65`）。 |

## 二、仓内可核实事实（逐条带 文件:行 证据）

- **F1 · schema 真源唯一**：`core/pinax/next/fact/domain/vocabulary.js:21` `export const FACT_SCHEMA = 'fact.data/v3'`；`:24` `FACT_SCHEMA_LEGACY = Object.freeze(['fact.data/v2'])`。除这两个值外全仓不存在第三种事实 schema 字符串（本批实测：`grep -rn "fact.data/" --include="*.mjs" --include="*.js" --include="*.md"` 除 node_modules/.history 外只命中 v3（活代码与测试夹具）与 v2（平移件注释），无其他）。
- **F2 · pedia/v1 已在谱系内**：`vocabulary.js:4-5`——规范唯一来源 `pedia-v2-adr-final.md`（2026-11-09 作者裁定）；v1 来源即 NovelPedia 的 `src/pedia_schema.json`（commit eb4f14018a61153023d32aed3679c1bb2682f336）。`vocabulary.js:26-32` `FACT_SOURCE` 把两边写成同一条出处链。
- **F3 · v3 相对 v2 只做减法**：`vocabulary.js:16-20`——v3 不再生成 `fact` 拼接副本与 `events[].title`（可确定性重建，`minimal` 档位控制），不改 id 输入、不改分层；v2 条目照常可读，存量不迁移。
- **F4 · 校验闸只认这一套**：`core/pinax/next/fact/domain/schema.js:391-393`——`schema` 不是 `fact.data/v3` 且不在 legacy 清单即报 `SCHEMA_MISMATCH`；写协议对每条 entries 逐条 `validateFactEntry`（`core/pinax/next/kernel/factFileStore.mjs:384`，校验器经 `pediaSchema.js` 进口，`factFileStore.mjs:6`）。
- **F5 · `pediaSchema.js` 是 re-export 桶，不是第二 schema**：`core/pinax/next/fact/domain/pediaSchema.js:1-13` 自述「只做 re-export」——词表/稳定 id/状态机/双时间轴/信封校验/视角校验各在自己文件里；旧入口 `wikihub/pediaSchema.mjs` 薄壳转发。**文件名里的「pedia」正是 pedia/v1→fact 谱系的活化石，内容就是 fact 的 domain 真源**。
- **F6 · 仓内没有 pedia/v1 导入导出实现**：`grep -rni "pedia"`（除 node_modules/.history）只命中——core 平移件注释与 `FACT_SOURCE`、`core/VENDORED.md:85`、`core/.vendored-manifest.json`（指纹）、`scripts/vendor-deduce.mjs:19`（同步清单）。没有任何读/写 pedia/v1 数据的业务代码。
- **F7 · 真源与派生分离是写协议的一部分**：`factFileStore.mjs:25-27`（写主 JSON 时始终剥顶层 `wiki`，另写兄弟 `<id>.wiki.json`，读侧两代兼容走 `readFactWiki()`）；`:41` `WIKI_DERIVED_SCHEMA = 'pinax-wiki-derived@1'`；`:348` patch 里 `wiki` ＝搬进兄弟文件（主 JSON 永远不落 wiki）；`:502-523` patch.wiki 优先、派生档先落主档后落。
- **F8 · enrich 派生产出落在 patch 的 `wiki` 层**：`enrichEngine.mjs:744-750`——`factStore.writeFactFile({ root, bookId, patch: { wiki }, operationId, expectedRevision })`，注释明言「patch 只带 wiki，主 JSON 的 entries/book 一字不动，实际落在兄弟 `<bookId>.wiki.json`」（`:735-737`）。六槽位在 `wiki.slots`（`:722`）、因果图 `wiki.causalGraph`（`:731`）、需求层级 `wiki.characterProfiles[].needs`（`:496-516`）、台账 `wiki.ledger`（`:724`）；整包版本 `wiki-enrich@3`（`:717`）。读回走 `readFactWiki`（`:816`）。
- **F9 · scriptFact 产出的就是 fact.data/v3**：`public/scriptFact.mjs:81,108,132` 三处 `schema: 'fact.data/v3'`；头注释「产出符合 fact.data/v3 的条目骨架」（`:6`）、「fact 侧字段必须过 schema」（`:14`）。剧本↔fact 是仓内唯一双向转换、往返验证过（`docs/AUDIT-ARTIFACTS.md:39-40,65`）。
- **F10 · fact 写通道已收敛**：库内写只有内核 `writeFactFile` 一个口（revision 自增＋operationId 幂等＋expectedRevision 乐观并发）；宿主侧经 `pinaxAdapter.factStore` 唯一进口（`pinaxAdapter.mjs:30,45`；OS-125，门禁 S2.4）。API 层的写端点 `POST /api/fact/entries/import` 也走它（`contracts/fact.mjs:30-48`；`daemon.mjs:2576-2605` 组 `patch: { book, entries }` 后调 `factStore.writeFactFile`）。

## 三、裁定落点

### a) fact.data/v3 是唯一事实 schema；pedia/v1 视为同源同质

依据 F1/F2/F4/F5：pedia/v1 本来就在 fact 词表的出处链上（`vocabulary.js:26-32`），本仓的 domain 真源文件自己就叫 `pediaSchema.js`——「统一成 fact」在代码里已经是既成事实，本裁定把它钉为口径：**不新增、不另立第二事实 schema**；legacy v2 读兼容照旧（F3），存量不迁移。

### b) OpenStory↔NovelPedia 导入导出一律走 fact.data/v3

依据 F4/F10：任何外部数据进库必须变成过 `validateFactEntry` 闸的 fact.data/v3 条目（写协议逐条校验，`factFileStore.mjs:384`）；出库同理从 fact 条目投影。**pedia/v1 的精确字段映射是唯一开放项（见 §六）：NovelPedia 源仓本机没有，映射在实现导入导出时以真实数据实测补齐，本文与实现都不许臆造字段名。**

### c) enrich 派生物按 FACT-FIRST 现口径留在事实链内；scriptFact 双向互转照旧

依据 F7/F8/F9/`FACT-FIRST.md:39-48`：六槽位/因果图/需求层级/状态台账落在 patch 的 **`wiki` 层**（内核写协议把它路由到兄弟 `<bookId>.wiki.json`，主档 entries/book 一字不动）——这就是「schema 内的派生层位」，裁定为**维持**：派生物不是独立数据源，不迁出事实链、也不另立存储。剧本↔fact 互转（唯一双向，F9）**照旧**，不在本裁定改动面。

## 四、四方消费方现状核查：只认这一个 schema

四个消费方的事实通道逐一实测（本批逐仓核对，非转述）：

| 消费方 | 读/写通道 | 证据（文件:行） |
|---|---|---|
| **enrich**（语义增补） | 读：调用方经 `factFileStore.list` 取 entries 传入；读回派生走 `readFactWiki`。写：`writeFactFile patch.wiki`（内核校验闸）。 | `enrichEngine.mjs:23`（factStore 经 pinaxAdapter 唯一进口）、`:202-209`、`:744-750`、`:816` |
| **剧情曲线** | 服务端 `factCurveGet`：读 `拆解/<id>.json` ＋ `readFactWiki`，plot 条目按 `provenance.chapters` 归组；前端 `/api/fact/curve` 消费。 | `daemon.mjs:1182-1249`（`:1204` readFactWiki、`:1207-1211` entries 归组）；`public/app.js:1340,7755`；`public/charts.mjs:2-8`（「fact 事件流」） |
| **知识图谱** | `referenceGraphGet`：条目经 `factStore.createFactFileStore().list()` 读入，作为只读节点进 `buildReferenceGraph`。 | `daemon.mjs:2561-2574`（`:2568-2570`）；`referenceStore.mjs:385` |
| **推演** | `loadEntries`：`factStore.createFactFileStore({root}).list({limit:5000})`，与 `/api/entries` 同源。 | `deduceEngine.mjs:14`（唯一进口）、`:33-40` |

辅证：条目级读端点 `factEntriesGet` 同走 `createFactFileStore().list()`（`daemon.mjs:1253-1305`，`:1266`）；故事源三形态数据源就是这两个读端点（`public/storySource.mjs:5`）。**结论：四方的读写全部收敛在 factFileStore 协议＋fact.data/v3 校验闸上，没有旁路 schema，合并路线在消费侧零新增改动。**

## 五、后续动作（G5b 起导入导出的改动面）

- **入向（已有通道，复用）**：`POST /api/fact/entries/import`（`contracts/fact.mjs:30-48`）→ `daemon.mjs:2576-2605` → 内核 `writeFactFile patch.entries`。NovelPedia 导入做成本地薄适配器：pedia/v1 数据 → fact.data/v3 条目，产出后走这同一条写通道，不另开写口。
- **出向（尚无端点）**：仓内目前没有「fact→外部格式」的导出端点——FACT-FIRST 待接入清单里的 `export-rag` 只是规划（`FACT-FIRST.md:123`），未实现（本批 grep 实测无代码）。NovelPedia 导出与 RAG 导出同源：都从 fact.data/v3 条目投影，实现时新增读侧导出，不动写协议。
- **不在改动面**：scriptFact 双向互转（落点 c 照旧）；四方消费方（§四，零改动）；内核写协议与 vendor 边界（core/** 只读复用，改动面在本仓适配器/端点层）。

**NovelPedia 字段映射实测清单（实现导入导出时逐条做，本 ADR 不预填任何字段）**：

1. 先取数：拿到真实 NovelPedia 数据样本（源仓本机没有，见 §六）。
2. 词表对照：`src/pedia_schema.json`（出处 commit 见 `vocabulary.js:28-29`）与本仓 `FACT_LAYERS`/`WORLDVIEW_SLOTS`/`CATEGORY_MAP`（`vocabulary.js:35-136`）逐项对——层的对齐口径（hard/soft）、槽位归并表是否逐条落得上。
3. 信封字段映射：provenance（mode/quote_hash/chapters/scenes）、fingerprint、status 状态机（draft→proposed→adopted→superseded，`vocabulary.js:144-159`）、validity 双时间轴，逐字段列「pedia 字段 → fact 字段 → 转换规则 → 丢失项」。
4. 双向往返损耗：回写 pedia/v1 时哪些 fact 字段无处安放（v3 的 events[].segments、track、rhythmSpec 等按 F3 是本仓增量），如实记录。
5. 映射表带样本证据落实现批次的交付说明/ADR 附录，测试用临时夹具库验证往返。

## 六、开放项（单列）

- **pedia/v1（NovelPedia）精确字段映射**——唯一开放项。源仓本机没有，本文无法核实其字段；一切映射以真实数据实测为准（§五清单），在那之前本文不写任何 pedia 侧字段名。这项是 §三b 的执行前提：没有实测映射，NovelPedia 导入导出不实现。

---

维护：本 ADR 是 G7 的裁定记录；裁定后的遗留事项（如 NovelPedia 映射实测）登记在 `docs/LEGACY-ITEMS.md`。翻案需作者明示，翻案后在本文件补记日期与理由。
