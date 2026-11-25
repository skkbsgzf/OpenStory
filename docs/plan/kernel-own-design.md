# OS-151 · 内核转自有：定名与归属（设计稿）

> 历史文档，仅作出处与决策留档；现状以 OS-172 为准

> **状态**：设计稿，未动一行代码。作者过目命名后才开 OS-152。
> **依据**：作者裁定（2026-11-24）「全部转自有」；底稿＝
> [`workorder-system-20261124.md`](workorder-system-20261124.md) §3 段 B 的默认命名与归属方案；
> 红线＝[`route-batch2-20261123.md`](route-batch2-20261123.md)（金样不动、旧库不迁移、每步独立提交）。
> **证据口径**：本文所有数字与判断来自 `find`/`wc -l`/`grep -n` 的实测输出，行号写在括号里。
> 不引用印象，拿不准的进第 9 节。
>
> **目录**
> 0. 摘要与三件待拍板的事
> 1. 现状盘点（实测，带文件:行）
> 2. 内核定名与身份
> 3. 归属图（24 个文件逐个落位）
> 4. 改名对照表
> 5. `pinaxAdapter` 解散方案
> 6. 迁移步骤（OS-152 → OS-157）
> 7. 互认金样
> 8. 出处声明（成稿）
> 9. 未决事项

---

## 0. 摘要与三件待拍板的事

### 0.1 一句话结论

`core/pinax/` 的 24 个文件（4,332 行）可以被切成 **6 个互不重叠的包**（123＋1,233＋984＋1,236＋756＝4,332，另加 OS-157 的世界书契约 948 行），
按「叶子先走、写协议最后摘」的顺序六步迁净；**磁盘格式名与对外契约名一个都不改**，只改目录结构、文件名、符号表名与注释——
兼容的锚从「vendor 字节」换成「落盘格式金样」（第 7 节）。

### 0.2 目标形态（一句话）

```
src/kernel/            内核＝宿主管道（errors/atomicWrite/fsDurability）＋ fact 链（domain/store/wikiDerive/factPack/enrich）
src/modules/deduce/engine/   推演链 8 件（产品引擎，不是内核）
```

内核身份串 **`openstory-kernel@1`**（与 `openstory-suite@2`、`openstory-module@1` 同一命名法）。

### 0.3 三个必须提醒的结构性发现

1. **迁移只能「影子复制 → 重指向 → 延后删除」**，不能「搬走即删」。
   `core/pinax/next/kernel/factFileStore.mjs:6` 引着 `core/.../domain/pediaSchema.js`，`core/.../fs/atomicWrite.mjs:4` 引着
   `core/.../electron/.../fsDurability.mjs`。core 目录内的文件**不许 import 本仓 `src/`**（`AGENTS.md` 硬规则 1、`ARCHITECTURE.md:250`
   「依赖只许向下」），而 `src/` 里除 adapter 外**不许 import `core/`**（门禁 S2.4）。两条硬规则夹在一起，
   决定了：底层件先「复制进 src 并直测」，真正的删除只能发生在其**最后一个 core 侧消费者搬家那一步**。
   逐文件删除表见 §6.7。工单 OS-152 写的「vendor 清单除名 2 项」因此在影子迁移下要顺延到 OS-156——
   这是本文对工单验收口径的唯一实质修改，请主 agent 确认。
2. **推演链进模块会逼出 Host API 的一处破坏性变更**。`fact.deduce` 这个命名空间成员原本就是给
   `src/modules/deduce/deduceEngine.mjs:18` 一个消费者用的；引擎搬进模块后，协议层不再能提供它
   （协议层反向 import 产品模块＝依赖倒挂）。建议 OS-155 一次性把 `host-api@1` 升 `@2`（删 `deduce`），
   段 B 末把 `@2` 形状定稿（再删 `projectMeta`／`projectImport`）。详见 §5.2、§9-3。
3. **工单说「内核错误码的 `PINAX_` 前缀换成自己的（对外字符串不变）」在字面上自相矛盾**：
   `PINAX_IO_FAILED` 这类字符串就是经 `/api` 出去的 `code`（`src/api/handlers/fact.mjs:737`
   把 `written.code` 直接交 `sendError`），还被三处测试逐字钉死（`test/decoupleStep3.test.mjs:112,119,136`、
   `test/factEntriesImport.test.mjs:183`）。我的方案：**只改表名与注释（`NEXT_ERROR_CODES`→`KERNEL_ERROR_CODES`），字符串值一律不动**。
   见 §4.4、§9-1。

### 0.4 最需要作者拍板的三件事

| # | 事 | 我的建议 | 作者裁定（2026-11-24） |
|---|---|---|
| A | 内核名字 `openstory-kernel@1` ＋ 位置 `src/kernel/` | 照默认方案，一句「可以」即开工 | **同意** |
| B | 推演链归模块（默认）还是留内核 | 归模块；代价是 `host-api@1→@2`（§9-3） | **同意**（Host API 升 `@2`） |
| C | `PINAX_*` 错误码字符串改不改 | 不改。它是线上 API 的 `code`，改＝破坏对外契约（§9-1） | **要改**（作者原话「c要改吧」）——方案见新增 §4.5 |

---

## 1. 现状盘点（实测）

### 1.1 24 个文件逐个

行数为 `wc -l` 实测（合计 4,332）。「直接消费方」＝ import 它的文件:行；「最终出口」＝用户可见的能力面。

| # | 路径（`core/pinax/…`） | 行 | 职责 | 直接消费方（仓内非测试，file:line） | 最终出口 |
|---|---|---:|---|---|---|
| 1 | `electron/projects/fsDurability.mjs` | 20 | 目录 fsync 耐久化（不支持的平台错误码吞掉） | `next/fs/atomicWrite.mjs:4`；经 adapter `src/kernel/pinaxAdapter.mjs:44` 转给 `src/protocol/hostWrite.mjs:22` | 全仓写盘 |
| 2 | `next/fact/domain/aliases.js` | 170 | 别名并查集（词↔规范名、冲突如实报） | `factPack.js:16`、`deduce/candidates.js:4`、`deduce/sceneContext.js:20` | fact 包投影、推演候选 |
| 3 | `next/fact/domain/pediaSchema.js` | 13 | `export *` 转发桶（6 个 domain 文件） | `next/kernel/factFileStore.mjs:6` | 条目校验入口 |
| 4 | `next/fact/domain/perspective.js` | 132 | 视角校验（某角色某时点是否已知） | **仅转发桶**；导出符号全仓零消费（`grep validatePerspective` 0 命中） | 无（死码） |
| 5 | `next/fact/domain/schema.js` | 464 | 条目信封校验（errors/warnings 两档） | 经 #3 被 `factFileStore.mjs:6` 取 `validateFactEntry` | `/api/entries`、写协议 |
| 6 | `next/fact/domain/stableId.js` | 72 | 稳定 id＋纯 JS SHA-1 | `vocabulary.js:11`、`schema.js:24`、`fronts.js:21`、`opening.js:6`、`patchChannel.js:23`、`settle.js:4` | 全链 id 口径 |
| 7 | `next/fact/domain/status.js` | 54 | 生命周期状态机 | 仅转发桶；`canTransitionStatus` 只在 `status.js:40` 自用 | 死码（导出面） |
| 8 | `next/fact/domain/validity.js` | 97 | 双时间轴区间运算 | `schema.js:25`、`factPack.js:14`、`sceneContext.js:21` | fact 包、推演 |
| 9 | `next/fact/domain/vocabulary.js` | 231 | 版本化词表＋`FACT_SCHEMA`／`FACT_SOURCE` | `schema.js:23`、`status.js:7`、`factPack.js:15`、`patchChannel.js:22`、`settle.js:3` | 全链词表 |
| 10 | `next/fact/usecases/deduce/candidates.js` | 164 | 三层候选（必然▮/命运⚙/戏剧✦）＋2d6 | `turn.js:7` | 扮演「呈现一拍」 |
| 11 | `next/fact/usecases/deduce/fronts.js` | 282 | 威胁前线／压力时钟 | `opening.js:8`、`settle.js:6`、`turn.js:10` | 扮演张力曲线 |
| 12 | `next/fact/usecases/deduce/opening.js` | 64 | 开局（世界冻结快照＋POV＋runId） | adapter `:35` → `deduceEngine.mjs:192` | 扮演开局 |
| 13 | `next/fact/usecases/deduce/patchChannel.js` | 240 | 已确认事实回写世界书（幂等补丁） | `opening.js:9` | 扮演→世界书 |
| 14 | `next/fact/usecases/deduce/sceneContext.js` | 204 | factPack→局面卡四字段投影 | `candidates.js:6`、`turn.js:9` | 扮演局面卡 |
| 15 | `next/fact/usecases/deduce/sessionState.js` | 50 | 会话状态容器 | `opening.js:7`、`candidates.js:5`、`settle.js:5`、`turn.js:8` | 扮演会话 |
| 16 | `next/fact/usecases/deduce/settle.js` | 115 | 结算→事件条目＋导演三动作 | adapter `:37` → `deduceEngine.mjs:324,326` | 扮演结算 |
| 17 | `next/fact/usecases/deduce/turn.js` | 117 | 有界推进回合 | adapter `:36` → `deduceEngine.mjs:208` | 扮演推进 |
| 18 | `next/fact/usecases/enrich/metrics.mjs` | 278 | 因果图三指标（闭环率/耦合度/断点敏感度） | adapter `:39` → `enrichEngine.mjs:821` | 故事源/概览 |
| 19 | `next/fact/usecases/enrich/pseudoChapters.mjs` | 74 | 伪章切分（无章节标记的正文） | adapter `:38` → `enrichEngine.mjs:228-230` | 故事源大纲 |
| 20 | `next/fact/usecases/factPack.js` | 194 | 事实包投影（此刻世界是什么样） | `deduce/sceneContext.js:19` | 扮演局面 |
| 21 | `next/fs/atomicWrite.mjs` | 48 | 原子写＋失败清场＋遗留临时文件回收 | adapter `:42` → `hostWrite.mjs:22`、`kernelPlumber.mjs:15` | 全仓写盘 |
| 22 | `next/kernel/errors.mjs` | 55 | 错误码表＋`ok/fail/throwFailure` | `factFileStore.mjs:5`；adapter `:41` → `kernelPlumber.mjs:15` | 全仓失败载荷 |
| 23 | `next/kernel/factFileStore.mjs` | 756 | 拆解仓储：读（合并/过滤/分页）＋写协议（revision/operationId/乐观并发）＋wiki 派生 | adapter `:34` → `handlers/fact.mjs:21,90,156,732,1040,1166`、`handlers/reference.mjs:31,55,304`、`services/systemPrompt.mjs:21,120`、`protocol/factGuard.mjs:16,67,96,140,223`、`deduceEngine.mjs:37`、`enrichEngine.mjs:747` | 故事源、世界书、增补、扮演 |
| 24 | `next/kernel/wikiDerive.mjs` | 438 | 纯计算 wiki 派生（章/人物/矩阵/因果） | `factFileStore.mjs:7`（`store.wikiDerive`，`:721`） | 故事源派生档 |

**合计 4,332 行 / 24 文件**（`find core/pinax -type f | wc -l` ＝ 24）。

### 1.2 依赖闭包（谁 import 谁）

```
adapter(pinaxAdapter.mjs)
 ├─ factFileStore ── errors
 │                 ├─ fact/domain/pediaSchema ── vocabulary ── stableId
 │                 │                            ├─ stableId
 │                 │                            ├─ status ── vocabulary
 │                 │                            ├─ validity
 │                 │                            ├─ schema ── vocabulary/stableId/validity
 │                 │                            └─ perspective
 │                 └─ wikiDerive        （零 import）
 ├─ deduce: opening ── stableId, sessionState, fronts, patchChannel ── vocabulary, stableId
 │          turn    ── candidates ── aliases, sessionState, sceneContext ── factPack ── validity/vocabulary/aliases
 │          settle  ── vocabulary, stableId, sessionState, fronts
 ├─ enrich: pseudoChapters（零 import）／metrics（零 import）
 ├─ plumber: errors; atomicWrite ── fsDurability
 └─ 转引自有件: projectDoc / importAdapter / textUtil（OS-123/124 fork 点，不在 24 件内）
```

- 24 个文件**全在闭包内**，无一个可以「先删」——与工单 §1 核对表一致（工单 `:18`）。
- 非测试代码里 import `core/` 的文件**只有 `src/kernel/pinaxAdapter.mjs` 一个**（`grep -rn "from '.*core/" src/` 只命中它，其余 12 处是注释）。

### 1.3 消费方清单（到文件）

`pinaxAdapter` 的消费者共 10 个文件，分两类：

| 类 | 文件 | 取的出口 |
|---|---|---|
| 协议层转供（门禁 `KERNEL_GATEWAY_ALLOW`，`tools/acceptance/acceptance.mjs:321-329`） | `src/protocol/index.mjs:35` | 五组全量，装配成 `fact` 命名空间 |
| | `src/protocol/kernelPlumber.mjs:15` | `ok/fail/writeFileAtomic` |
| | `src/protocol/hostWrite.mjs:22` | `writeFileAtomic/TMP_PREFIX/syncDirectory` |
| | `src/protocol/chapters.mjs:14` | `projectImport.parseChapterNumber` |
| | `src/protocol/factGuard.mjs:16` | `factStore` |
| 直引（OS-142 未约束的面） | `src/api/handlers/fact.mjs:21` | `factStore` |
| | `src/api/handlers/reference.mjs:31` | `factStore` |
| | `src/services/systemPrompt.mjs:21` | `factStore` |
| 经协议层 `fact` 命名空间（模块 / 服务） | `src/modules/deduce/deduceEngine.mjs:18` | `deduce`＋`factStore` |
| | `src/services/enrichEngine.mjs:27` | `enrich`＋`factStore` |
| | `src/modules/library/libraryManage.mjs:35` | `projectMeta`＋`projectImport` |

### 1.4 「Pinax 谱系名」三类归户

统计口径：`grep -rli "pinax\|pedia"`，排除 `node_modules`、`.git`、`docs/plan`（历史记录）、`.ua`、`.zcode/tmp`（施工残留）——
**155 个文件**、`pinax` 约 979 处、`pedia` 约 161 处；其中 `src/` 41 个文件、`test/` 34 个、`core/` 9 个。

下面按**模式**分类，每个模式给出全量覆盖关系（一条模式管住它的全部命中，不遗漏）。

#### 1.4.1 磁盘格式名（**一个都不改**）

改动会读不了作者既有库，或破坏与 Pinax 桌面端的互认。

| 名字 | 写到哪（证据） | 谁读 | 现状证据 |
|---|---|---|---|
| `.pinax/`（元数据根） | 建库 `src/modules/library/projectDoc.mjs:61`（`METADATA_DIR`）、`:15`（`proposals`/`state`） | `src/host/authorize.mjs:20,144`（禁入校验）、`src/protocol/libState.mjs:25-26`、`src/protocol/changelog.mjs:26` | `AGENTS.md` 硬规则 10 落盘表；`samples/水浒传/.pinax/` |
| `.pinax/project.json` ＋ `pinax-project@3` | `projectDoc.mjs:59`；`samples/水浒传/.pinax/project.json:2` | `projectDoc.mjs:120`（范式校验）、金样 `test/decoupleStep2.test.mjs:45,62,79,124` | 金样逐字节钉死 |
| `pinax-project@1/@2`（旧库读侧） | `projectDoc.mjs:60` | 同上 | 旧库不迁移 |
| `pinax.carrier.novel` / `pinax.carrier.script` | `projectDoc.mjs:31,35,43-44`、`src/modules/library/libraryManage.mjs:64-65`、`public/app.js:191,6789-6790`、`genres/*.json` | 同上＋体裁裁剪 | 也进 `project.json` 的 `carriers` |
| `pinax-wiki-derived@1` | `core/.../factFileStore.mjs:41`、`src/api/handlers/fact.mjs:1055`、`public/scriptFact.mjs:148` | `readFactWiki`（兄弟档）；样本 `samples/水浒传/拆解/shuihu.wiki.json:4` | 派生档头 |
| `fact.data/v3` / `fact.data/v2` | `core/.../vocabulary.js:21,24`、`public/scriptFact.mjs:81,108,132` | `validateFactEntry`、`FACT_SCHEMA_LEGACY` | `samples/水浒传/拆解/shuihu.json:9…` |
| `.pinax-tmp-`（原子写临时前缀） | `core/.../atomicWrite.mjs:10`；`src/protocol/hostWrite.mjs:14,50` | `recoverInterruptedWrites`（`atomicWrite.mjs:35-48`）、`test/hostWrite.test.mjs:24,86` 断言 | 崩溃后遗留文件回收约定 |
| `.operations.jsonl` | `factFileStore.mjs:40,401` | 幂等旁路日志；`samples/水浒传/拆解/.operations.jsonl` | 写协议幂等 |
| `.pinax/{log,drafts,ui-state.json,proposals,state,sync-state.json}`、`.history/` | `changelog.mjs:26`、`libState.mjs:25-26`、`projectDoc.mjs:15`、`contracts/reference.mjs:85` | 各模块自检索 | `AGENTS.md` 落盘表 |
| `deduce-session/v1`（引擎态 `version`） | `core/.../deduce/sessionState.js:6`；整态经 `deduceEngine.mjs:112-115` 落 `.openstory/deduce/<id>.json` | 引擎自身 | 未进金样，但**已落作者磁盘** |

> 分类判据：只要「改了这个串」会让某个已落盘文件读不出／写不进，就归本类，一律标**不改**。
> `.pinax-tmp-` 是瞬时文件但属同一判据（老版本的崩溃遗留要靠它回收），也归本类。

#### 1.4.2 对外契约名（**一个都不改**）

| 名字 | 写到哪 | 谁读 | 现状 |
|---|---|---|---|
| `PINAX_INVALID_INPUT` / `PINAX_IO_FAILED` / `PINAX_STALE_REVISION` 等 **错误码字符串** | `core/.../errors.mjs:5-37`（`NEXT_ERROR_CODES` 的**值**）；`factFileStore.mjs:51-56` 解析后作为 `code` 返回 | `/api` 响应体（`handlers/fact.mjs:737` `sendError(res, written.code…)`）；`src/protocol/chapterWrite.mjs:165`、`src/modules/library/libraryManage.mjs:116` 用 `^PINAX_` 剥前缀；测试逐字锁死（`test/decoupleStep3.test.mjs:112,119,136`、`test/factEntriesImport.test.mjs:183`、`test/contracts.test.mjs:263`） | 改＝换线上契约 |
| MCP 工具名 | `src/host/mcp.mjs`（24 个 `openstory_*`） | 外部调用方 | **本来就无 Pinax 名**，无需处理 |
| 端点路径 | `src/api/contracts/**`（`/api/*`，101 个） | 前端、MCP 薄适配 | **本来就无 Pinax 名**，无需处理 |

#### 1.4.3 纯代码内部名（**可改，本批要改的都在这里**）

| 名字 | 位置 | 处置 |
|---|---|---|
| 目录 `core/pinax/next/…`、`usecases/`、`kernel/`、`fs/`、`electron/projects/` | 见 §3 | 全部消失，换成 `src/kernel/` 自有结构 |
| 文件名 `pediaSchema.js` | `core/.../domain/pediaSchema.js` | 改名（NovelPedia 谱系＋它是桶不是 schema） |
| 符号 `NEXT_ERROR_CODES` | `core/.../errors.mjs:5`、`factFileStore.mjs:5,51-53` | 改 `KERNEL_ERROR_CODES` |
| 文案 `throwFailure` 的 `'Pinax-Next operation failed'` | `errors.mjs:50` | 改（零消费者，纯兜底文案） |
| 常量 `FACT_SOURCE`（含 `'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR'`） | `vocabulary.js:26-32` | **死导出**（全仓零消费）——建议删或改写，见 §9-5 |
| 注释：24 个文件的头注释（「Core 平移件」「vendor 自 Pinax-next@…」「内核统一错误码」）＋ `src/` 里 41 个文件的 `pinax` 提法 | 逐文件 | 随搬随改（§8 给模板） |
| 脚本 `scripts/vendor-core.mjs`／`vendor-deduce.mjs`／`vendor-drift.mjs`、`core/.vendored-manifest.json` | 仓根 | OS-157 退役 |
| `test/vendorDrift.test.mjs`（16 例） | | OS-157 退役 |

#### 1.4.4 谱系外（**本单不动，登记以免误伤**）

| 名字 | 位置 | 归属 |
|---|---|---|
| `%LOCALAPPDATA%/PinaxNext/…`（院子）、`next-preferences.json`、`PINAX_OS_PREFERENCES` | `src/host/authorize.mjs:5,26,29,37`、`src/host/daemon.mjs:111-115`、`agentStore/kbAdapter/genres/nativePicker/runtimes/skills/stylePacks/suites/systemPrompt` 各 `:27-43` | **段 D**（OS-163/164 品牌分家） |
| `package.json:author` ＝「Pinax 作者（OpenStory 线）」 | 仓根 | 品牌，段 D/E |
| 套件 manifest 的 `"vendor": "Pinax 官方"` | `suites/*/manifest.json` | 品牌元数据，非内核 |
| `samples/水浒传`、`docs/**`、`skills/**`、`genres/**` 的叙述性提法 | | 文档/样本，随 §8 口径统一 |

### 1.5 顺带发现（影响第 3、6 节的设计）

1. **死码**：`perspective.js`（132 行）导出零消费；`FACT_SOURCE`（7 行）零消费；`status.js` 只经转发桶存在、无直接符号消费者。
2. **重复实现**：伪章公式在 `wikiDerive.mjs:22-74` 与 `enrich/pseudoChapters.mjs:20-74` 各一份（`plotMinSegment`/`pseudoChapterCount`/`derivePseudoChapters`/`hasRealChapters` 全同）。
   注释说「内核不能反向依赖 devtools」——转自有后这个理由消失，可合并（§9-6）。
3. **字面量四处散落**：`pinax-wiki-derived@1` 出现在 core、handler、public、fixtures 四处，无单一真源（§9-7）。
4. **前缀解析两处**：`chapterWrite.mjs:165` 与 `libraryManage.mjs:116` 各自 `replace(/^PINAX_/u,'')`，改前缀会同时打断（又一条「不改」的证据）。

---

## 2. 内核定名与身份

### 2.1 名字

| 项 | 值 | 理由 |
|---|---|---|
| 中文名 | **OpenStory 内核** | 与「工作面模块」「业务套件」并列 |
| 身份串 | **`openstory-kernel@1`** | 与 `openstory-suite@2`（`src/services/suites.mjs:24`）、`openstory-module@1`（`src/protocol/modules.mjs:36`）、`openstory-skill@1`／`openstory-runtime-kit@1`（`src/protocol/versionGate.mjs:4`）同一命名法 |
| 代码位置 | `src/kernel/` | 段 B 默认；OS-140 布局宪法六目录之一，已存在（当前只有 `pinaxAdapter.mjs`） |
| 版本语义 | `@1` 是**落盘与能力面**的版本，不是包版本 | 破坏「写协议语义／fact 条目校验口径」才升 `@2`；纯代码重构不升 |

### 2.2 身份常量放哪、谁导出

- 新文件 **`src/kernel/identity.mjs`**（~15 行）：

  ```js
  export const KERNEL_ID = 'openstory-kernel@1'
  export const KERNEL_VERSION = 1
  export const KERNEL_NAME = 'OpenStory 内核'
  ```

  之所以单开文件而不写进 `index.mjs`：`index.mjs` 会成为「公开面＋身份」两件事，测试要一条
  `import { KERNEL_ID }` 就得拖进整个内核装配；单文件是叶子、零依赖，测试与门禁都能轻量取。
- **`src/kernel/index.mjs`** 再 `export * from './identity.mjs'`，使消费方只认一个进口。
- 身份串的**验证点**（OS-157 落地）：
  1. `test/kernelIdentity.test.mjs` 断言字面量与 `@1` 形状；
  2. `GET /api/health` 响应**增补**一个 `kernel` 字段（纯增量，不改既有字段；`src/api/contracts/system.mjs` 的 health 定义加一行）。
     这一条是**建议、非必须**——它的价值是「作者在浏览器/巡检脚本里能一眼看见内核身份」。

### 2.3 模块 manifest 要不要声明兼容的内核版本

**建议：不声明内核版本；改为声明 Host API 版本。**

- 理由一：模块（`src/modules/**`）**看不见内核**——门禁 S2.1 只许它引 node 内置、`src/protocol/**`、自己目录
  （`tools/acceptance/acceptance.mjs:207-225`）。它真正依赖的契约是 Host API，不是内核实现。
- 理由二：给模块一个「内核版本」等于允许它钉死一个自己观察不到的实现，反而妨碍内核内部演进（段 B 的全部意义）。
- 理由三：现状 3 份 manifest（`src/modules/{analysis,comfyui,kb}/module.manifest.json`）都没有这个字段，
  加**必填**字段＝三份全红＋`test/modulePlugins.test.mjs` 形状校验改写，收益为零。
- 落法：manifest 可选字段 `hostApi: "host-api@2"`，缺省＝不限；比对复用 `src/protocol/versionGate.mjs`
  的 `satisfiesMinVersion`／`minVersionGate`（已有能力，不新写）。**本批不实现**，只把键名与语义定下来，免得以后各写一套。

---

## 3. 归属图

### 3.1 目标树

```
src/kernel/
├── index.mjs                  ← 新建：内核公开面（装配，不含业务）
├── identity.mjs               ← 新建：openstory-kernel@1
├── errors.mjs                 ← 管道件（原 core/pinax/next/kernel/errors.mjs）
├── atomicWrite.mjs            ← 管道件（原 next/fs/atomicWrite.mjs）
├── fsDurability.mjs           ← 管道件（原 electron/projects/fsDurability.mjs）
├── fact/
│   ├── factFileStore.mjs      ← 写协议＋读面（756 行，最后摘）
│   ├── wikiDerive.mjs         ← 纯派生（438）
│   ├── factPack.mjs           ← 事实包投影（194）
│   └── domain/
│       ├── index.mjs          ← 原 pediaSchema.js（转发桶，改名）
│       ├── aliases.mjs  schema.mjs  stableId.mjs
│       ├── status.mjs   validity.mjs  vocabulary.mjs  perspective.mjs
└── enrich/
    ├── pseudoChapters.mjs
    └── metrics.mjs

src/modules/deduce/engine/     ← 推演链（产品引擎，不进内核）
├── index.mjs                  ← 新建：只导出四个端子（openDeduceSession/presentTurn/applyDirectorAction/settleChoice）
├── opening.mjs  turn.mjs  settle.mjs  candidates.mjs
├── fronts.mjs   patchChannel.mjs  sceneContext.mjs  sessionState.mjs

src/protocol/factDomain.mjs    ← 新建：domain 原语＋factPack 的协议层转供（给推演引擎，见 §5.1）
```

### 3.2 24 个文件逐个落位

| 原文件 | 目标 | 归属 | 说明 |
|---|---|---|---|
| `next/kernel/errors.mjs` | `src/kernel/errors.mjs` | 内核·管道 | 全仓唯一的失败载荷形状，必须一个 |
| `next/fs/atomicWrite.mjs` | `src/kernel/atomicWrite.mjs` | 内核·管道 | 写通道红线落点 |
| `electron/projects/fsDurability.mjs` | `src/kernel/fsDurability.mjs` | 内核·管道 | `electron/` 是上游桌面壳目录，不保留 |
| `next/kernel/factFileStore.mjs` | `src/kernel/fact/factFileStore.mjs` | 内核·fact | 文件名不改（描述性，无谱系） |
| `next/kernel/wikiDerive.mjs` | `src/kernel/fact/wikiDerive.mjs` | 内核·fact | 纯读派生 |
| `next/fact/usecases/factPack.js` | `src/kernel/fact/factPack.mjs` | 内核·fact | 纯读投影 |
| `next/fact/domain/aliases.js` | `src/kernel/fact/domain/aliases.mjs` | 内核·fact | |
| `next/fact/domain/schema.js` | `src/kernel/fact/domain/schema.mjs` | 内核·fact | |
| `next/fact/domain/stableId.js` | `src/kernel/fact/domain/stableId.mjs` | 内核·fact | |
| `next/fact/domain/status.js` | `src/kernel/fact/domain/status.mjs` | 内核·fact | 导出面疑似死码（§9-5） |
| `next/fact/domain/validity.js` | `src/kernel/fact/domain/validity.mjs` | 内核·fact | |
| `next/fact/domain/vocabulary.js` | `src/kernel/fact/domain/vocabulary.mjs` | 内核·fact | 词表是内核的宪法 |
| `next/fact/domain/perspective.js` | `src/kernel/fact/domain/perspective.mjs` | 内核·fact | 死码，建议删（§9-5） |
| `next/fact/domain/pediaSchema.js` | `src/kernel/fact/domain/index.mjs` | 内核·fact | 桶→index，`pedia` 去名 |
| `next/fact/usecases/enrich/pseudoChapters.mjs` | `src/kernel/enrich/pseudoChapters.mjs` | 内核·enrich | 只读度量 |
| `next/fact/usecases/enrich/metrics.mjs` | `src/kernel/enrich/metrics.mjs` | 内核·enrich | 只读度量 |
| `next/fact/usecases/deduce/opening.js` | `src/modules/deduce/engine/opening.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/turn.js` | `src/modules/deduce/engine/turn.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/settle.js` | `src/modules/deduce/engine/settle.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/candidates.js` | `src/modules/deduce/engine/candidates.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/fronts.js` | `src/modules/deduce/engine/fronts.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/patchChannel.js` | `src/modules/deduce/engine/patchChannel.mjs` | 扮演模块 | 注意：它**产出**待采纳条目，属产品面 |
| `next/fact/usecases/deduce/sceneContext.js` | `src/modules/deduce/engine/sceneContext.mjs` | 扮演模块 | |
| `next/fact/usecases/deduce/sessionState.js` | `src/modules/deduce/engine/sessionState.mjs` | 扮演模块 | |

**合计**：内核 16 件（3 管道＋13 fact/enrich）＋ 推演 8 件 ＝ 24。另加新建 3 件（`identity.mjs`、`index.mjs`、`engine/index.mjs`）与 1 个转供叶子（`protocol/factDomain.mjs`）。

### 3.3 `vendor/contracts/worldbookFileContract.js`（948 行，不在 24 件内）

| 项 | 结论 |
|---|---|
| 目标位置 | **`src/modules/worldbook/worldbookFileContract.mjs`** |
| 归属 | 世界书模块（它是世界书条目的**文件格式**契约，不是内核能力） |
| 消费方改迁 | `src/protocol/worldbookContract.mjs:14`（转供叶）改指新位置；`test/decoupleStep1.test.mjs:20` 直引改指新位置 |
| 为什么不进 `src/kernel/` | 内核是「宿主＋fact 链」；md＋frontmatter 的世界书文件格式属参考/世界书业务，进内核会让内核替一个模块背格式（与 OS-124 砍载体清单同一理由） |
| 为什么不进 `src/protocol/` | 它是**实现**（~900 行 parser/emitter），不是转供；协议层只放薄叶（照 `worldbookContract.mjs` 现状） |
| 磁盘影响 | 零。它读写的是 `参考/*.md` 的既有格式，文件名改了不影响任何落盘内容 |

### 3.4 与默认方案的偏差

**零处偏离默认归属**（推演 8 件→模块、fact 链→内核、管道件→内核、契约→世界书）。
唯一需要作者知情的是**默认方案没写的两件配套**：

1. `src/protocol/factDomain.mjs`——推演引擎要用 fact 域原语（`stableEntryId`/`FACT_SCHEMA`/`createAliasIndex`/`buildFactPack`…），
   而模块不许直引 `src/kernel/**`。新增一个协议层转供叶子是**唯一不破坏 S2.1 的最小解**（§5.1、§9-3 备选方案 B）。
2. `parseChapterNumber` 要从 `src/modules/library/textUtil.mjs` **上移进协议层**（建议 `src/protocol/chapterNumber.mjs`），
   否则 `protocol/chapters.mjs` 为了一个纯函数永远得经 adapter 转引一个模块（§5.1）。

---

## 4. 改名对照表

### 4.1 文件路径

| 旧 | 新 | 改？ | 为什么 |
|---|---|---|---|
| `core/pinax/next/kernel/errors.mjs` | `src/kernel/errors.mjs` | 改 | `pinax/next/kernel` 是上游仓的物理结构，与本仓六目录无关 |
| `core/pinax/next/fs/atomicWrite.mjs` | `src/kernel/atomicWrite.mjs` | 改 | 同上；`fs/` 只有两件，不值得保留一层 |
| `core/pinax/electron/projects/fsDurability.mjs` | `src/kernel/fsDurability.mjs` | 改 | `electron/projects` 是上游桌面壳 |
| `core/pinax/next/kernel/factFileStore.mjs` | `src/kernel/fact/factFileStore.mjs` | 只改目录 | **文件名不改**：描述性、无谱系，且它是全仓最高风险文件，改名只增加 diff 噪声 |
| `core/pinax/next/kernel/wikiDerive.mjs` | `src/kernel/fact/wikiDerive.mjs` | 只改目录 | 同上 |
| `core/pinax/next/fact/usecases/factPack.js` | `src/kernel/fact/factPack.mjs` | 改目录＋扩展名 | `usecases/` 是上游分层名；`.js`→`.mjs` 见下 |
| `core/pinax/next/fact/domain/*.js`（6 件） | `src/kernel/fact/domain/*.mjs` | 改目录＋扩展名 | 同上 |
| `core/pinax/next/fact/domain/pediaSchema.js` | `src/kernel/fact/domain/index.mjs` | 改名 | `pedia`＝NovelPedia 谱系；它本来就是 6 行 `export *` 转发桶，叫 `schema` 名不副实 |
| `core/pinax/next/fact/usecases/enrich/*.mjs` | `src/kernel/enrich/*.mjs` | 改目录 | |
| `core/pinax/next/fact/usecases/deduce/*.js`（8 件） | `src/modules/deduce/engine/*.mjs` | 改位置＋扩展名 | 默认归属；扩展名见下 |
| `vendor/contracts/worldbookFileContract.js` | `src/modules/worldbook/worldbookFileContract.mjs` | 改位置＋扩展名 | §3.3 |

> **`.js`→`.mjs` 不是洁癖，是门禁要求**：`tools/acceptance/acceptance.mjs:189-194` 的模块纪律扫描
> 只匹配 `.mjs` 相对说明符（正则 `\.mjs'`）。推演 8 件若在 `src/modules/**` 里保留 `.js`，
> S2.1 会**静默漏扫**——违规 import 抓不到。这是实测约束，不是风格选择。

### 4.2 导出符号

| 旧 | 新 | 改？ | 为什么 |
|---|---|---|---|
| `NEXT_ERROR_CODES` | `KERNEL_ERROR_CODES` | 改 | `Next` 指上游线名；表名是纯内部名（值不动，见 4.4） |
| `throwFailure` 的消息 `'Pinax-Next operation failed'` | `'OpenStory 内核操作失败'` | 改 | 纯兜底文案，`grep` 全仓零调用点 |
| 转发桶 `pediaSchema` 的再导出面 | 不变（`export *` 六件） | 不改 | 改了就得动 `factFileStore` 的 import，收益为零 |
| `FACT_SOURCE` | 删除（或改 `repository` 文案） | 建议删 | 零消费；保留一个没人读的出处常量只会与 README 分叉（§9-5） |
| `TMP_PREFIX`／`WIKI_DERIVED_SCHEMA`／`FACT_DIR_NAME`／`OPERATIONS_LOG_NAME`／`FACT_WRITE_CODES`／`factEntryDerivations` | 名字与值都不变 | 不改 | 名字不是谱系名；值是磁盘面（§1.4.1） |
| `DEDUCE_DRAMA_SYSTEM_PROMPT` 等推演常量 | 不变 | 不改 | 文案是 OpenStory 自己的双叙述纪律 |
| adapter 五组出口名 `factStore/deduce/enrich/projectMeta/projectImport` | 前三个名字保留 | 部分保留 | `factStore`/`enrich` 继续存在于 Host API；`deduce`/`projectMeta`/`projectImport` 随 §5 退出 |

### 4.3 常量文案（注释与出处）

| 位置 | 旧 | 新 |
|---|---|---|
| `errors.mjs:2` | `Pinax-Electron-Next · 内核统一错误码（规范 v1 第 3/4 节）` | `OpenStory 内核 · 统一错误码（openstory-kernel@1）` |
| `vocabulary.js:2` | `fact.data/v2 版本化词汇表（domain 真源，Core 平移件）` | `fact.data/v3 版本化词汇表（OpenStory 内核 · fact 域真源）` |
| `vocabulary.js:27` | `repository: 'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR'` | 删（见 §4.2）或改 `'OpenStory fact 词表（谱系见 README 致谢段）'` |
| `schema.js:2`／`status.js:2`／`validity.js:2`／`aliases.js:2`／`perspective.js:2`／`stableId.js:2` | `（Core 平移件）` | 按 §8.2 模板重写为 OpenStory 出处声明 |
| `metrics.mjs:1-2`／`pseudoChapters.mjs:1-2` | `vendor 自 Pinax-next@devtools/lib/…（2026-11-16 逐字拷贝）` | 按 §8.2 模板 |
| 24 个文件头 | 各自的 Pinax 提法 | 统一按 §8.2 |

### 4.4 错误码前缀

| 项 | 处置 | 证据 |
|---|---|---|
| 表名 `NEXT_ERROR_CODES` | **改** `KERNEL_ERROR_CODES` | 纯内部（§4.2） |
| 值 `'PINAX_INVALID_INPUT'` 等 25 个字符串 | **要改**（作者 2026-11-24 裁定；两步走见 §4.5） | 它们是 `/api` 响应的 `code`（`handlers/fact.mjs:737`）；被 `chapterWrite.mjs:165`、`libraryManage.mjs:116` 用 `^PINAX_` 解析；被 `test/decoupleStep3.test.mjs:112,119,136`、`factEntriesImport.test.mjs:183`、`contracts.test.mjs:263` 逐字锁死 |
| 端口码 `OPERATION_ID_REQUIRED`／`VALIDATION_FAILED`／`REVISION_MISMATCH`／`NOT_FOUND` | 不改 | 本来就不是谱系名 |

> 与工单原文的冲突已登记 §9-1。若作者坚持「品牌要干净」，唯一安全路径是**另立工单**：
> 新增 `OPENSTORY_*` 别名码、旧码保留一整个大版本、前端与测试同步双读——那是一次真正的对外契约变更，不属于「转自有」。


### 4.5 错误码改名方案（作者裁定 C：要改）

**目标**：仓里不再出现 `PINAX_` 前缀；内核码与宿主码收敛成一套 OpenStory 自己的词表。

**关键事实（实测，决定了分几步做）**：
- `src/protocol/chapterWrite.mjs:165` 早就在剥前缀（`code.replace(/^PINAX_/u, '')`），再映射到 `src/protocol/apiErrors.mjs` 的对外码表；
- 但并非所有路径都过这层映射：`test/factEntriesImport.test.mjs:183` 断言 `body.error.code === 'PINAX_IO_FAILED'`——即**裸内核码会直接透给客户端**；
- `core/pinax` 内部多处 import `errors.mjs` 的 `ERROR_CODES` 并比较码值，迁移期一定会出现「core 副本」与「自有副本」两套词表并存。

**因此分两步**：

1. **OS-152（迁 errors.mjs）**：影子复制进 `src/kernel/`，**码值一个字不改**（两套副本必须词表一致，否则迁移期码比较会错）；只把表名改为 `KERNEL_ERROR_CODES`。
2. **OS-157（收尾退役）**：`core/` 已无消费者后**一次性扫净**：
   - 码值去掉 `PINAX_` 前缀 → 与宿主码表同一命名法（`PINAX_INVALID_ENTRY` → `INVALID_ENTRY`、`PINAX_IO_FAILED` → `IO_FAILED`、`PINAX_STALE_REVISION` → `STALE_REVISION` …），
     并核对与 `src/protocol/apiErrors.mjs` 的同名码语义一致；语义不同的（如内核 `STALE_REVISION` vs 宿主 `REVISION_MISMATCH`）在映射表处显式对应。
   - `chapterWrite.mjs` 的剥前缀逻辑随之简化（已无前缀可剥）或删除；
   - 本地环境变量一并改名并**双读兼容一个大版本**：`PINAX_OS_PREFERENCES` → `OPENSTORY_PREFERENCES`、`PINAX_OS_FIXTURE` → `OPENSTORY_FIXTURE`（新名优先、旧名仍认、命中旧名打一次 deprecation 日志）；
   - 文档与测试同批：`docs/ACCEPTANCE.md`、`ARCHITECTURE.md` 的错误码段、对外契约表；测试里的字面量断言逐个改为新值；
   - **对外变更记录**：新增一节「错误码改名对照表（旧 → 新）」进 `docs/`，供外部调用方（MCP 客户端、脚本）迁移。

**不做兼容层**：不保留「旧码也能返回」的双发。理由：作者要的是干干净静的自家名字；双发会让词表永久分裂。代价是外部调用方需照对照表改一次——已由对照表承接。

---

## 5. `pinaxAdapter` 解散方案

### 5.1 五组出口的去处

| 出口 | 现实现 | 解散后消费方从哪取 | 备注 |
|---|---|---|---|
| `factStore` | core `factFileStore` | `src/kernel/fact/factFileStore.mjs`（经 `src/kernel/index.mjs`）；`fact.factStore` 继续存在 | `handlers/fact`、`handlers/reference`、`systemPrompt` 改 import 路径即可；`factGuard`／`deduceEngine`／`enrichEngine` 经命名空间不动 |
| `deduce` | core `opening/turn/settle` | `src/modules/deduce/engine/index.mjs`，由 `deduceEngine.mjs:14-18` 直引 | **`fact.deduce` 退出 Host API**（协议层不许依赖产品模块）→ `host-api@2`，见 §9-3 |
| `enrich` | core `pseudoChapters/metrics` | `src/kernel/enrich/*`；`fact.enrich` 继续存在 | 零消费方改动 |
| `projectMeta` | 转引 `modules/library/projectDoc` | `libraryManage.mjs` 直接引同目录 `./projectDoc.mjs`（模块内组合，S2.1 ③ 明文允许） | `fact.projectMeta` 退出 |
| `projectImport` | 转引 `modules/library/importAdapter`＋`textUtil` | `libraryManage.mjs` 直接引 `./importAdapter.mjs`；`parseChapterNumber` 上移 `src/protocol/chapterNumber.mjs`，`textUtil.mjs` 与 `protocol/chapters.mjs` 都从协议层取 | `fact.projectImport` 退出；`protocol/chapters.mjs:14` 不再需要 adapter |
| plumber `ok/fail/writeFileAtomic` | core `errors/atomicWrite` | `src/kernel/errors.mjs`、`src/kernel/atomicWrite.mjs` | `kernelPlumber.mjs` 改 import 目标，文件保留（fork 点仍要原名转供） |
| `TMP_PREFIX`／`syncDirectory` | core `atomicWrite`/`fsDurability` | 同上 | `hostWrite.mjs:22` 改 import 目标 |

**结果**：`src/protocol/**` 对 `src/modules/**` 的依赖降到 **0**（今天有 3 条，全经 adapter）。
这是一次顺手修掉的分层倒挂，且是解散 adapter 的副产品，不额外付代价。

### 5.2 Host API 如何承接

`src/protocol/index.mjs` 的 `fact` 命名空间从「转引 adapter」改为「转引内核公开面」：

```js
// OS-157 之后的形状
import * as kernelFact from '../kernel/fact/factFileStore.mjs'
import * as kernelEnrich from '../kernel/enrich/index.mjs'
import { ok, fail } from '../kernel/errors.mjs'
import { writeFileAtomic } from '../kernel/atomicWrite.mjs'
export const fact = Object.freeze({ factStore, enrich, ok, fail, writeFileAtomic })
```

版本处置：**段 B 内只升一次版，且分两次落笔**——

| 时点 | `HOST_API_VERSION` | `fact` 键 | 必须同步改 |
|---|---|---|---|
| 现在 | `host-api@1` | `deduce, enrich, factStore, fail, ok, projectImport, projectMeta, writeFileAtomic`（`test/hostApi.test.mjs` SNAPSHOT） | — |
| OS-155 末 | **`host-api@2`**（删 `deduce`＝破坏性） | 7 键 | `test/hostApi.test.mjs:34-36,48,65`、`src/protocol/README.md` 能力清单、`src/protocol/index.mjs:9-11,55-57` |
| OS-157 末 | 仍 `@2`（`@2` 段内未发布，形状在此定稿） | 5 键（再删 `projectImport`/`projectMeta`） | 同上 |

> 为什么不在 OS-157 一次升：OS-155 之后 `fact.deduce` 已无实现可指，留一个空壳或假装「下次再说」
> 都是撒谎。`@2` 在 OS-155 落第一次，段末冻结，符合「破坏性变更才升版」的语义。

### 5.3 门禁 S2.4 的三步演化

现状（`tools/acceptance/acceptance.mjs:311-342`）：
`src/` 全部 `.mjs`＋两个垫片中，除 `src/kernel/pinaxAdapter.mjs` 外不得出现 `core/**` 说明符；
且 `src/protocol/**` 里引 adapter 的文件必须在 `KERNEL_GATEWAY_ALLOW` 点名单内。

| 阶段 | 判据 | 动作 |
|---|---|---|
| OS-152–155 | 不变 | 一个字节都不改：adapter 仍引 `core/factFileStore`，`adapterCoreUse` 为真 |
| OS-156 | core 目录里已无 `.mjs`（只剩 `VENDORED.md`／manifest） | 改判据为二选一：`coreMjs.length === 0 ? coreSpecifiers.length === 0 : (adapterCoreUse && 违规 0)`；证据文案改「内核已转自有，core/ 只剩历史文档」 |
| OS-157 | `core/` 与 `vendor/` 全撤 | **S2.4 退役成一行**：`S2.4' src/ 与仓根垫片不得出现 'core/' 路径说明符`（防陈旧 import 回潮，零成本）。`KERNEL_GATEWAY_ALLOW`／`adapterCoreUse`／`gatewayRogue` 全部删除；`isProtocolPath`（`:235`）里的 `src/kernel/pinaxAdapter.mjs` 换成 `src/kernel/index.mjs`（`src/kernel/**` 属底层，与 `core/` 同义） |

配套：`docs/ACCEPTANCE.md:12,64`、`AGENTS.md` 硬规则 1 的「内核 vendor 禁改」段、`ARCHITECTURE.md` L2/L3 同步改写（§8.4）。

### 5.4 循环引用与装载序

现在的循环是 `pinaxAdapter → projectDoc/importAdapter → kernelPlumber → pinaxAdapter`（adapter 头注 `:25-28` 有解释，
`test/decoupleStep3.test.mjs` 与 `test/hostApi.test.mjs` 两向冒烟钉死）。解散后：

- `kernelPlumber → src/kernel/errors.mjs`（叶子，不再回指 adapter）→ **环断**；
- `protocol/index → kernel/**`（只向下）＋ `protocol/index → protocol/*`（同层）→ 无环；
- `modules/deduce/engine/* → protocol/factDomain`（模块→协议）＋ `deduceEngine → engine`（模块内）→ 无环；
- `protocol/factDomain → kernel/fact/{domain,factPack}`（协议→内核）→ 无环。

装载序风险从「四角环」降为「无环」，`test/hostApi.test.mjs` 的双向子进程冒烟可以保留（它测的是装配顺序，不是环）。

---

## 6. 迁移步骤（OS-152 → OS-157）

### 6.0 依赖与顺序

```
OS-152 管道件 ──┬─→ OS-156 写协议（要用 errors/atomicWrite）
                └─→ （全程）
OS-153 domain ──┬─→ OS-155 推演链（用 stableId/vocabulary/validity/aliases/factPack）
                ├─→ OS-154 factPack
                └─→ OS-156 写协议（用 schema 校验）
OS-154 派生/enrich ─→ OS-155（factPack）
OS-155 推演链 ─────→ OS-156（无依赖，但需先空出 core 的 deduce 消费者）
OS-156 写协议 ─────→ OS-157（core 清空）
```

**硬依赖**：`OS-152 < OS-156`、`OS-153 < OS-154 < OS-155 < OS-156`。
**真正的删除顺序**由「最后一个 core 侧消费者」决定，见 6.7——这也是 §0.3-1 的由来。

### 6.1 OS-152 · 管道件转自有（123 行）

| 项 | 内容 |
|---|---|
| 迁 | `errors.mjs`→`src/kernel/errors.mjs`；`atomicWrite.mjs`→`src/kernel/atomicWrite.mjs`；`fsDurability.mjs`→`src/kernel/fsDurability.mjs`（**复制**，core 原件保留） |
| 改 import | `atomicWrite` 的 `../../electron/projects/fsDurability.mjs`→`./fsDurability.mjs`；adapter `:41-44` 改指新位置 |
| 不改 | `core/factFileStore.mjs:5` 仍引 core 的 errors；**`hostWrite`／`kernelPlumber` 改为直取 `src/kernel/`（OS-152 施工时采纳的直接指向；原设计写「仍经 adapter」，实际做成了直取，更干净）** |
| 新增测试 | `test/kernelPlumber.test.mjs`：① 码表 25 个**值**逐字锁定（防改名顺手改值）；② 未知码回落 `PINAX_INVALID_INPUT`；③ `writeFileAtomic` 失败清场＋`recoverInterruptedWrites` 回收 `.pinax-tmp-*`；④ `syncDirectory` 对 `EINVAL/ENOTSUP/EISDIR/win32 EPERM` 免疫、真错照抛 |
| 红线测试 | `test/hostWrite.test.mjs`（原子性＋二进制分支）、`test/changelog.test.mjs`、`test/historyRetention.test.mjs`、`test/decoupleStep3.test.mjs:112-137` |
| vendor 清单 | 0 项除名（工单原文写 2 项——影子迁移下做不到，见 §0.3-1；core 原件仍在供 `factFileStore` 用） |
| 回滚 | 一个提交，`git revert` 即回到 adapter 直引 core |

### 6.2 OS-153 · fact 词表与校验转自有（1,233 行）

| 项 | 内容 |
|---|---|
| 迁 | domain 8 件→`src/kernel/fact/domain/`（`pediaSchema.js`→`index.mjs`）；**复制**，core 原件保留 |
| 改 import | 8 件内部互引只改扩展名；`factFileStore`（core）**不动**，仍引 core 的桶 |
| 新增测试 | `test/kernelFactDomain.test.mjs`：`validateFactEntry` 对样本条目逐字段；`stableEntryId` 同输入同 id（含中文/别名）；`isActiveAt/intersectValidity` 边界（null＝无界）；状态机幂等与非法转移；`createAliasIndex` 冲突如实报；`FACT_SCHEMA==='fact.data/v3'`（值锁定） |
| 红线测试 | `test/contracts.test.mjs`（`/api/entries` 291 条夹具）、`test/factEntriesImport.test.mjs`、`test/decoupleStep3.test.mjs:70-71` |
| 回滚 | 一个提交 |

### 6.3 OS-154 · fact 派生与包装转自有（984 行）

| 项 | 内容 |
|---|---|
| 迁 | `wikiDerive`→`src/kernel/fact/wikiDerive.mjs`；`factPack`→`src/kernel/fact/factPack.mjs`；`enrich/{pseudoChapters,metrics}`→`src/kernel/enrich/` |
| 改 import | enrich 两件的唯一消费者是 adapter（`:38-39`），**当场改指新位置并删除 core 两份**（它们没有 core 侧消费者，见 6.7）；`wikiDerive`/`factPack` 仍被 core 的 store／sceneContext 引，原件保留 |
| 新增测试 | `test/kernelEnrich.test.mjs`：伪章数 `clamp(round(chars/2200),4,12)` 边界；`causalSummary` 三指标对固定图；`deriveWiki` **幂等**（同输入跑两遍深等）；`factPack` 查询区间语义（无界/相交/角色知情） |
| 红线测试 | `test/fact-curve.test.mjs`、`test/styles.test.mjs`、`test/artifacts.test.mjs` |
| vendor 清单 | 除名 2 项（enrich 两件）→ 22 |
| 回滚 | 一个提交 |

### 6.4 OS-155 · 推演链归位（1,236 行）＋ llmPort 接口整理

| 项 | 内容 |
|---|---|
| 迁 | 8 件→`src/modules/deduce/engine/`（`.js`→`.mjs`）；新建 `engine/index.mjs`；新建 `src/protocol/factDomain.mjs` |
| 改 import | 引擎内：域原语改从 `../../../protocol/factDomain.mjs` 取；`factPack` 同源；引擎内部相对路径不变。`deduceEngine.mjs` 改引 `./engine/index.mjs` |
| Host API | 删 `fact.deduce`；`HOST_API_VERSION='host-api@2'`；同步 `test/hostApi.test.mjs` SNAPSHOT／字面量、`src/protocol/README.md`、`index.mjs` JSDoc |
| llmPort | 现状是「有就给、没就空数组」（`deduceEngine.mjs:205-211`）；整理成**显式接口文档**：`llmPort.propose({prompt, refs}) → [{text, refs}]`（或 `null`），写进 `src/modules/deduce/README.md` 的契约段，并加一条形状测试（非法返回＝候选层报错、不崩拍） |
| 删除 | core 的 deduce 8 件 ＋ `factPack.js`（后者最后一个消费者 `sceneContext` 已走） |
| 新增测试 | `test/deduceDeterminism.test.mjs`：「同种子＋同事实包＝同一拍」逐字段锁；`patchChannel` 幂等（同事件回写两次＝一条）；`fronts` 只进不退；llmPort 缺失/非法两态 |
| 红线测试 | `test/deduceEngine.test.mjs`、`test/storyTree.test.mjs`、`test/script-fact.test.mjs`、`test/hostApi.test.mjs` |
| vendor 清单 | 除名 9 项 → 13 |
| 回滚 | 一个提交（含 `host-api@2` 的同步改；回退时 `@1` 一并回来） |

### 6.5 OS-156 · 写协议转自有（756 行）

| 项 | 内容 |
|---|---|
| 迁 | `factFileStore.mjs`→`src/kernel/fact/factFileStore.mjs`；改 import：`./errors.mjs`→`../errors.mjs`、`../fact/domain/pediaSchema.js`→`./domain/index.mjs`、`./wikiDerive.mjs`→`./wikiDerive.mjs`（同目录不变）。**它今天没有 import `atomicWrite`**（`grep -n atomicWrite core/pinax/next/kernel/factFileStore.mjs` 0 命中，写盘走 `node:fs/promises` 的 `writeFile/rename`），所以本步没有第四处 import 要改——这一点与「写通道已收敛到 hostWrite」不矛盾：store 的 `writeFactFile` 是 fact 协议的**语义**写入口，不归宿主原子写管 |
| 删除 | core 剩余 13 件（store 1＋wikiDerive 1＋domain 8＋管道 3）；`core/` 只剩 `VENDORED.md` 与 `.vendored-manifest.json` |
| adapter | 此时 adapter 已无 `core` 可引，但**不能**直接 `export *`：它还要为 `libraryManage`／`chapters` 供 `projectMeta`／`projectImport`（这两组要到 OS-157 才退出）。本步把它改成**纯装配**——`factStore`／`enrich` 取自 `../kernel/index.mjs`，`projectMeta`／`projectImport` 仍转引 `../modules/library/*`，plumber 取自 `../kernel/{errors,atomicWrite}.mjs`；删文件留给 OS-157，保证 S2.4 仍有落点 |
| 新增测试 | `test/factWriteProtocol.test.mjs`：operationId 幂等（重放→`duplicate:true` 且 revision 不涨）；`expectedRevision` 冲突→`PINAX_STALE_REVISION`；revision 自增；多文件合并/分页/过滤；`readFactWiki` 兄弟档优先、坏档回落信封；写失败时原文件完好且目录无 `.pinax-tmp-*` |
| 红线测试 | `test/decoupleStep2.test.mjs`（建库金样）、`test/decoupleStep3.test.mjs`（五组出口）、`test/factGuard` 三定律、`test/hostWrite`、`test/libraryManage.test.mjs` |
| vendor 清单 | 0 项 → `npm run vendor:check` 只剩 pinaxCore 段 1 项 |
| 回滚 | 一个提交；回退后 core 13 件与 adapter 的旧 import 一并恢复 |

### 6.6 OS-157 · 收尾退役

| 项 | 内容 |
|---|---|
| 世界书契约 | `vendor/contracts/worldbookFileContract.js`→`src/modules/worldbook/worldbookFileContract.mjs`；改 `protocol/worldbookContract.mjs:14`、`test/decoupleStep1.test.mjs:20`、`scripts/vendor-drift.mjs` 的 pinaxCore 段（退役时一起删） |
| adapter | 删 `src/kernel/pinaxAdapter.mjs`；`protocol/{index,kernelPlumber,hostWrite,chapters,factGuard}` 改指 `src/kernel/**` 或新叶子；`parseChapterNumber` 上移 `src/protocol/chapterNumber.mjs`，`textUtil`／`chapters` 改取 |
| Host API | 删 `fact.projectMeta`／`fact.projectImport`；`@2` 定稿；`SNAPSHOT.fact` → `['enrich','factStore','fail','ok','writeFileAtomic']` |
| vendor 退役 | 删 `core/`（VENDORED.md＋manifest）、`vendor/`（tgz＋provenance＋contracts）、`scripts/vendor-{core,deduce,drift}.mjs`、`test/vendorDrift.test.mjs`、`npm run vendor:check`、`package.json` 的脚本行 |
| 门禁 | S2.4 退役成 `S2.4'`（§5.3）；`isProtocolPath` 改 `src/kernel/index.mjs`；`AGENTS.md` 硬规则 1／7 的表把 `core/**`、`vendor/contracts/**` 行换成 `src/kernel/**`；`ARCHITECTURE.md` L2/L3 合并（§8.4） |
| 新增测试 | `test/kernelInterop.test.mjs`（§7）＋ `test/kernelIdentity.test.mjs` |
| 退役 | `test/decoupleStep3.test.mjs` 转写成 `test/kernelSurface.test.mjs`（测内核公开面，不测已消失的 adapter）；`test/vendorDrift.test.mjs` 删除 |
| 回滚 | 一个提交；但**这是唯一「回滚即恢复 vendor 纪律」的步**——建议提交前主 agent 备份现场（高危单惯例） |

### 6.7 六步的账与删除表

| 步骤 | 内容 | 行数 | 本步删除的 core 文件 | core 剩余 | 依据（最后一个 core 侧消费者） |
|---|---|---:|---|---:|---|
| 152 | 管道 3 件 | 123 | 0 | 24 | `core/factFileStore.mjs:5` 仍引 core errors |
| 153 | domain 8 件 | 1,233 | 0 | 24 | `core/factFileStore.mjs:6` 仍引 core 桶 |
| 154 | 派生 2＋enrich 2 | 984 | enrich 2 | 22 | enrich 无 core 侧消费者 |
| 155 | 推演 8 件 | 1,236 | deduce 8＋factPack 1 | 13 | `core/sceneContext.js:19` 搬走后 factPack 无主 |
| 156 | 写协议 1 件 | 756 | store 1＋wikiDerive 1＋domain 8＋管道 3 | 0 | store 是全部下端件的最后消费者 |
| — | **合计** | **4,332** | 24（另世界书契约 948 行在 157） | — | |

---

## 7. 互认金样

### 7.1 为什么要换锚

今天的互认锚是 **vendor 字节**（`core/.vendored-manifest.json` ＋ `npm run vendor:check`，`core/VENDORED.md:95-116`）。
转自有后源码必然分叉，字节锚失效；但**兼容的实质从来没变**：作者既有库与 Pinax 桌面端只认落盘格式。
所以锚换成**冻结的落盘片段**——`test/decoupleStep2.test.mjs` 已经在这么干了（`project.json` 的字段序/缩进/尾随换行逐字节锁死），
本设计只是把它扩展到 fact 文件与 wiki 派生档。

### 7.2 夹具从哪来、放哪

| 项 | 设计 |
|---|---|
| 来源 | **Pinax 桌面端真实产出的库片段**（不是 OpenStory 产、不是手写）。由作者用桌面端建一个最小库、录入 2–3 条条目、跑一次 wiki 派生，把三个文件拷出；**夹具本身由主 agent 提供**，本设计只定形状 |
| 三件 | ① `.pinax/project.json`　② `拆解/<bookId>.json`（含 ≥1 worldview、≥1 character、≥1 plot，且有 `validity` 与 `events`）　③ `拆解/<bookId>.wiki.json` |
| 位置 | `test/fixtures/pinax-desktop/`（**固定路径**，不按日期分目录——版本信息记在 `PROVENANCE.json` 里，测试路径才不会随抓取次数变） |
| 出处 | 同目录 `PROVENANCE.json`：`{ capturedAt, desktopVersion, upstreamCommit: "70a4f44", note, files: { "<相对路径>": "<sha256>" } }` |
| 纪律 | 夹具**只读**：测试一律先 `cp` 到 `mkdtemp` 再写；夹具目录本身永不落新文件。夹具入仓＝测试必跑（**不用** `skip: !process.env.X` 的软跳法） |
| 为什么不用 `samples/水浒传` | 它是 OpenStory 自己产/改的样例库，不能证明「读得进 Pinax 桌面端的东西」。它继续当演示库，不当互认锚 |

### 7.3 测试怎么写（`test/kernelInterop.test.mjs`）

```
0) 夹具存在性 + sha256 与 PROVENANCE.json 一致（夹具被误改＝红）
1) 读 project.json
   - readProjectDocument(fixtureRoot) → ok
   - validateProjectDocument 通过；spec==='pinax-project@3'；schemaVersion===3
   - value.carriers 与原文深等（primary/enabled/revision）
   - 原文键序与缩进与 PROJECT_DOC_FIELDS 一致（复用 decoupleStep2 的字节口径）
2) 读 fact 文件
   - createFactFileStore().list({}) → 条数 === 原文 entries.length
   - 逐 id get → 每条与原文对应条目**深等**（schema/layer/name/status/validity/events/provenance…）
   - store.list({layer}) 过滤口径与原文相符
3) 写得出（在 tmp 副本上）
   - writeFactFile({operationId:'interop-1'}) 追加一条 → revision === 原 revision+1
   - 重放同 operationId → duplicate:true 且 revision 不变
   - expectedRevision=旧值 → code==='PINAX_STALE_REVISION'（值不改，见 §4.4）
   - 回读：新条目逐字段等于写入值
4) wiki 派生
   - readFactWiki → derivedFrom.schema==='pinax-wiki-derived@1'
   - store.wikiDerive → 成功；再读回 derivedFrom.factRevision === 当前 revision
   - deriveWiki 幂等：同输入两次深等
5) project 写回
   - 在 tmp 副本 writeProjectDocument(同内容) → 与金样 project.json **逐字节相等**（除 id/时间戳本就未变）
```

**判据**：「读得进、写得出、字段逐项相等」三件全部落在 1–5 里；任一条红＝互认断了，**拦发布**。

### 7.4 维护纪律

- 夹具**不随版本升级频繁更换**：它锚的是格式，不是功能。只有 Pinax 桌面端**改格式**时才换，且换夹具＝一次显式提交（`PROVENANCE.json` 记新版本与原因）。
- 与 `decoupleStep2` 的分工：后者锚「建库输出」（我们自己写出来的 bytes），前者锚「别人给的输入」（我们读得对不对）。两者互补，不互相替代。

---

## 8. 出处声明

出处**随代码走**（`workorder-system-20261124.md:147`）：`core/VENDORED.md` 记录的
Pinax-next `feat/pinax-electron-next`@`70a4f44` 与 @pinax/core 0.16.0（`e56a0bc`）必须改写进 README 与文件头，**不随 vendor 身份一起删**。

### 8.1 README 致谢段（替换 `README.md:84` 现段）

> **出处与致谢**
>
> OpenStory 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness) 的 openstory/ 线独立而来
> （2026-11-14 起，OS-1→OS-133 批次逐批交付）。
>
> **内核**（`src/kernel/`，身份 `openstory-kernel@1`）自 2026-11-24 起为 OpenStory 自持实现：
> 其管道件、fact 词表与校验、写协议、派生层最初逐字取自 Pinax-next 分支 `feat/pinax-electron-next`
> 提交 `70a4f44`（2026-11-15）；世界书文件格式契约取自 `@pinax/core` 0.16.0（pinax-core 仓 `e56a0bc`）。
> 转自有后代码在本仓自由演进，**不再与上游同步**；出处与转有时的文件对应关系存档于
> `docs/plan/kernel-own-design.md`。
>
> 兼容的锚不是代码，是**落盘格式**：`.pinax/project.json`＝`pinax-project@3`、
> `拆解/*.json`＝`fact.data/v3`、`*.wiki.json`＝`pinax-wiki-derived@1`——与 Pinax 桌面端双向可读，
> 由 `test/kernelInterop.test.mjs` 的冻结夹具守护。建库/导入/章节号解析自 OS-123/124 起即为本仓自持。
> 设计对标 OpenDesign（dsHarness 生态）的插件接入与用户体验口径。

### 8.2 `src/kernel/` 各文件头注释（模板）

```js
/**
 * OpenStory 内核 · <一句话职责>（openstory-kernel@1）
 *
 * 谱系：2026-11-24 由 Pinax-next `feat/pinax-electron-next`@`70a4f44`
 * 的 `<上游路径>` 转自有（OS-15x）。此后在本仓演进，上游不再同步；
 * 出处与互认口径见 docs/plan/kernel-own-design.md §7、§8。
 *
 * 落盘格式不改：<本文件涉及的磁盘面，如 无 / 拆解/<id>.json 的 revision 字段>
 */
```

**逐文件落款**（`<上游路径>` 一列，直接抄 `core/VENDORED.md:12-17` 的映射）：

| 新路径 | 上游路径 |
|---|---|
| `src/kernel/errors.mjs` | `next/kernel/errors.mjs` |
| `src/kernel/atomicWrite.mjs` | `next/fs/atomicWrite.mjs` |
| `src/kernel/fsDurability.mjs` | `electron/projects/fsDurability.mjs` |
| `src/kernel/fact/factFileStore.mjs` | `next/kernel/factFileStore.mjs` |
| `src/kernel/fact/wikiDerive.mjs` | `next/kernel/wikiDerive.mjs` |
| `src/kernel/fact/factPack.mjs` | `next/fact/usecases/factPack.js` |
| `src/kernel/fact/domain/*.mjs` | `next/fact/domain/<同名>.js` |
| `src/kernel/enrich/*.mjs` | `next/fact/usecases/enrich/<同名>.mjs`（注：上游无此二文件，随本仓 OS-FACT 批次 `be71a12` 入库，见 `VENDORED.md:113-116`） |
| `src/modules/deduce/engine/*.mjs` | `next/fact/usecases/deduce/<同名>.js` |
| `src/modules/worldbook/worldbookFileContract.mjs` | `@pinax/core` 0.16.0 `src/domain/worldbookFileContract.js`（pinax-core `e56a0bc`） |

### 8.3 `PUBLISHING.md`（替换 `:25` 的出处条款）

> LICENSE 与出处自洽；`README.md` 致谢段记内核谱系（Pinax-next `70a4f44`／@pinax/core 0.16.0 `e56a0bc`）与
> 「落盘格式即互认锚」的口径；`package.json` 带 repository/license/engines；**不写真实私人邮箱**。
> 不再有 `core/VENDORED.md` 与 `npm run vendor:check`——互认由 `test/kernelInterop.test.mjs` 冻结夹具守护。

### 8.4 `ARCHITECTURE.md` 与 `core/VENDORED.md` 的处置

| 文档 | 处置 |
|---|---|
| `ARCHITECTURE.md:163-202`（L3/L2 两节） | 合并成一节 **`### L2 src/kernel/（自有内核，openstory-kernel@1）`**：管道件／fact 链／enrich 三组＋身份串＋「无上游同步，互认靠落盘金样」；分层表（`:35-41`）由 `npm run arch:stats` 重生成，手改只改节文 |
| `ARCHITECTURE.md:226-249`（vendor 纪律段） | 删除；换成「内核演进纪律：写协议只经 `factFileStore.writeFactFile`；磁盘格式名冻结清单见 §1.4.1」 |
| `core/VENDORED.md` | 文件随 `core/` 删除，**内容不是丢**：§1.1／§8.2 的映射表已把它逐条搬进设计稿；建议 OS-157 把 `core/VENDORED.md` 全文追加到 `docs/LEGACY-ITEMS.md` 的「历史归档」段（保留 OS-123/124/132 的解耦史） |
| `AGENTS.md` 硬规则 1 | 「内核 vendor 禁改」整条重写为「内核自有、磁盘格式名冻结；`core/**`／`vendor/**` 已退役」 |

---

## 9. 未决事项（每条附建议）

| # | 事项 | 现状与矛盾 | 我的建议 |
|---|---|---|---|
| 1 | `PINAX_*` 错误码字符串改不改 | 工单写「前缀换成自己的（对外字符串不变）」；但该字符串**就是**对外字符串（`handlers/fact.mjs:737`），且被 3 处测试与 2 处 `^PINAX_` 解析钉死 | **不改值，只改表名/注释**。真要品牌干净另立工单＋别名码＋双读过渡 |
| 2 | 24 件全迁，是否顺手删死码 | `perspective.mjs` 132 行、`FACT_SOURCE` 7 行零消费 | OS-153 迁（保持「全转」口径）；**删除另立小单**，别混进迁移提交（回滚粒度会糊） |
| 3 | 推演链的 Host API 代价 | 默认方案把 `deduce` 移出 `fact` ＝ `host-api@1→@2` | 接受 `@2`（§5.2）。若作者不愿动 Host API：备选＝推演 8 件留 `src/kernel/deduce/`，`fact.deduce` 原样——但「内核只留管道＋fact 链」的北极星要打个折 |
| 4 | 推演引擎怎么取 fact 原语 | 模块不许直引 `src/kernel/**`（S2.1） | 新增 `src/protocol/factDomain.mjs` 转供叶（§5.1）。备选＝给 S2.1 加一条 `src/modules/deduce/engine/** → src/kernel/fact/**` 显式豁免（更省一个文件，但开了一个口子） |
| 5 | `.pinax-tmp-` 要不要品牌化 | 它是瞬时前缀，但老版本崩溃遗留靠它回收 | **不动**。若将来要换，做法＝双前缀扫描一轮再切（另立单） |
| 6 | 伪章公式两份 | `wikiDerive.mjs:22-74` vs `enrich/pseudoChapters.mjs:20-74` | OS-154 合并（`wikiDerive` 改引 `enrich/pseudoChapters`），并加「两处同值」测试先绿后删 |
| 7 | `pinax-wiki-derived@1` 四处散落 | core、handler、public、fixtures 各写一遍 | OS-156 后让 handler/public 从 `src/kernel` 常量取（public 走 `/api` 响应时回传），**值不变**；本单只记账 |
| 8 | 互认夹具的抓取 | 需作者用 Pinax 桌面端产一个最小库 | 请主 agent 按 §7.2 清单抓取并落 `PROVENANCE.json`；抓取前 OS-157 不能算完成 |
| 9 | `enrich` 为什么留内核而 `deduce` 不留 | 两者都是「跑在 fact 上的用例」，标准看似不一 | 判据＝**只读派生 vs 产生新状态**：`enrich` 是纯函数度量（不落盘），`deduce` 是会产生条目与会话状态的交互引擎。按此线切，别按「谁先用」切 |
| 10 | `%LOCALAPPDATA%/PinaxNext`、`next-preferences.json` | 与内核无关，是院子/清单品牌 | 段 D（OS-163/164）。本单**不碰**，只在 §1.4.4 登记防误伤 |
| 11 | `samples/水浒传` 是否改名/迁移 | 它是 OpenStory 样例库 | 不迁（旧库不迁移红线）；仅确保它继续被 `samples` 检查覆盖 |
| 12 | 影子迁移导致的「清单除名顺延」 | 工单 OS-152 验收写「除名 2 项」，实际要等 OS-156 | 请主 agent 确认改验收口径（§0.3-1、§6.7）；这是硬规则夹出来的唯一可行序，不是偷懒 |

---

### 附：本单的核对命令（供复核者复现）

```bash
find core/pinax -type f | wc -l                      # 24
find core/pinax -type f | xargs wc -l | tail -1       # 4332
grep -rn "from '.*core/" src/ --include=*.mjs         # 仅 pinaxAdapter.mjs
grep -rn "pinaxAdapter" src/ tools/ --include=*.mjs    # 10 个消费方
grep -n "export" core/pinax/next/kernel/factFileStore.mjs
grep -rn "PINAX_" src/ test/ | grep -v 注释            # 对外码证据
grep -rli "pinax\|pedia" . --include=*.mjs --include=*.js --include=*.json \
  | grep -v node_modules | grep -v '^./.git' | grep -v '^./docs/plan' | wc -l   # 155
```
