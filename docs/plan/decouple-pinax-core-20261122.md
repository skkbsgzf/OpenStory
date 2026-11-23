# Pinax 内核解耦规划（2026-11-22）

> ✅ **已收官（OS-123→133，2026-11-23）**——四步解耦全部落地，遗留见 [docs/LEGACY-ITEMS.md](../LEGACY-ITEMS.md)。
> 实施后架构见 [ARCHITECTURE.md](../../ARCHITECTURE.md)（七层实测分层）；本文保留作施工单原貌，数字与文件清单以实施时点为准。

> 作者口径：「pinax 的职能和目前 openstory 需要持续解耦，让内核更简单，兼容性更强」
>
> 本文不是理念文，是施工单。每一条都带实测数字与验收口径；所有数字来自 `git ls-files` ＋ 递归 import 闭包追踪，不是估的。

---

## 0. 一句话结论

**现在不是「耦合太深」，而是「vendor 得太贪」。**

内核 12,551 行里，OpenStory **真正需要的是 4,286 行**（fact 存储 + 推演端子 + enrich 度量）。剩下 **8,265 行（65.9%）是 vendor 闭包顺手拖进来的**，其中 2,718 行（server 层）只为一个 15 行的中文数字解析函数、2,604 行（载体注册体系）只产出 2 条目录映射。

所以解耦不需要重写任何东西，只需要三步：**收缩 vendor 闭包 → 补一层自有适配 → 加上游漂移检测**。

---

## 1. 现状：接触面全图

### 1.1 谁真的碰内核（6 / 33 个后端模块）

| 模块 | 行数 | 从内核取什么 | 真正用到的方法 |
|---|---|---|---|
| `daemon.mjs` | 4,992 | `factFileStore` | `createFactFileStore().list/get`、`writeFactFile`、`readFactWiki` |
| `enrichEngine.mjs` | 831 | `factFileStore` + enrich 度量 | `list/get`、`derivePseudoChapters`、`causalSummary` |
| `deduceEngine.mjs` | 335 | 推演端子 + `factFileStore` | `openDeduceSession`、`presentTurn`、`applyDirectorAction`、`settleChoice`、`list` |
| `libraryManage.mjs` | 291 | 建库 7 处 | 见 §1.3 |
| `factGuard.mjs` | 257 | `factFileStore` | `list`、`readFactWiki`、`FACT_DIR_NAME` |
| `chapters.mjs` | 189 | 章节号解析 | **`parseChapterNumber` 一个纯函数** |

合计 6,901 行；接触面 **26 个符号 / 17 条 import**，全部单向（内核反向 import 本仓：0 条）。

### 1.2 五个能力的真实闭包成本

| 能力 | 最小闭包 | 占比说明 |
|---|---|---|
| fact 存储协议 | 10 文件 / 2,322 行 | 含 domain 校验 6 文件 + wikiDerive + errors |
| 推演端子 | 13 文件 / 2,013 行 | opening/turn/settle 拖进 candidates/fronts/sceneContext/patchChannel |
| enrich 度量 | 2 文件 / 354 行 | 最干净的一个 |
| **章节号解析** | **8 文件 / 2,723 行** | ⚠️ 15 行纯函数，代价 2.7K 行 |
| **建库** | **29 文件 / 6,721 行** | ⚠️ 产出只是 2 条目录映射 |

后两项是本次解耦的主战场。

### 1.3 建库那 7 处 import 到底换来了什么

```js
// libraryManage.mjs 的真实需求 vs 内核提供的量
PROJECT_KINDS        → 3 个 kinds 的目录表（23 行常量）
resolveClosure       → 依赖闭包求解（但 novel/script 的 requires 都是 []）
projectManifest      → 读写 .pinax/project.json（schemaVersion 3）
projectImportAdapter → planImport/runImport（拖进整个 server 层）
wizardKit            → 3 个纯函数：describeOpenFailure/validateLibraryName/folderName
carrierBootstrap     → 装 11 份清单（只用 novel/script 两份）
core/index.mjs       → createRegistry/createProject/initBareProject
```

**关键发现**：`novel` 与 `script` 两份清单的 `requires` 都是 `[]`，`dataDirs` 各只有一条（`manuscript: '正文'` / `script: '剧本'`）。也就是说，那 2,604 行的载体注册体系 ＋ 1,050 行的 11 份清单，对 OpenStory 的输出只是：

```js
novel  → projectKind: 'novel',    dataDirs: { manuscript: '正文' }
script → projectKind: 'screenplay', dataDirs: { script: '剧本' }
```

---

## 2. 目标架构：一条更窄的腰

```
┌──────────────────────────────────────────────────────────────┐
│  OpenStory 后端（33 模块）                                    │
│                                                              │
│  ┌────────────────────┐        ┌──────────────────────┐     │
│  │ 27 个零内核模块     │        │ 6 个接内核模块        │     │
│  └────────────────────┘        └──────────┬───────────┘     │
│                                            │                 │
│                    ┌───────────────────────▼──────────────┐  │
│                    │  pinaxAdapter.mjs（新增·自有层）      │  │
│                    │  ─ 唯一允许 import core 的文件        │  │
│                    │  ─ 把 26 个符号收敛成 5 个能力接口    │  │
│                    │  ─ 内核换版本只改这一个文件            │  │
│                    └───────────────────────┬──────────────┘  │
└────────────────────────────────────────────┼─────────────────┘
                                             │
              ┌──────────────────────────────▼──────────────────┐
              │  core/（收缩到 4,286 行 / 22 文件）              │
              │  ─ fact 存储（含 domain 校验 + wikiDerive）      │
              │  ─ 推演端子                                       │
              │  ─ enrich 度量                                    │
              │  逐字 vendor，禁改，带漂移检测                    │
              └──────────────────────────────┬──────────────────┘
                                             │
              ┌──────────────────────────────▼──────────────────┐
              │  @pinax/core 0.16.0（只需 4 子路径 / 1,237 行）  │
              └─────────────────────────────────────────────────┘
```

**腰窄在哪**：内核从「4 个能力 + 一堆建库机械」变成「3 个能力」；接触面从 26 个符号收成 5 个方法组；所有版本变动被 `pinaxAdapter.mjs` 单点吸收。

---

## 3. 三步施工

### 第 1 步：砍掉 server 层依赖（省 2,723 行，风险最低）

**问题**：`chapters.mjs` 为了中文数字解析，拖进 8 文件 2,723 行的 server 层。

**做法**：
1. 把 `parseChapterNumber`（15 行纯函数）拷进本仓 `textUtil.mjs`，连测试一起（中文数字「一百二十三」这类边界必须有例）
2. `chapters.mjs` 改引本仓版本，删掉 `core/pinax/server/`
3. `projectImportAdapter` 里也用到它——但那属于第 3 步要一起处理的范围

**为什么安全**：这是纯函数，输入输出可穷举验证。测试先行：把内核版本当 oracle，对本仓版本跑同样的用例。

**验收**：`core/pinax/server/` 目录消失；`node --test` 全绿；水浒传第一章 10/10、新建项目 13/13 不回归。

---

### 第 2 步：建库改为本仓自持，内核只留「格式契约」（省 3,654 行）

这是最需要作者拍板的一条。

**问题**：载体注册体系（2,604）＋ 11 份清单（1,050）＝ 3,654 行，产出 2 条目录映射 + 一个 `requires: []` 的空闭包求解。

**做法**：本仓新建 `carrierSkills.mjs`（约 80 行）自持载体知识：

```js
// 只为 OpenStory 服务的最小载体表——不是内核的替代品，是 OpenStory 的视图
export const CARRIERS = {
  'pinax.carrier.novel':  { projectKind: 'novel',     dataDirs: { manuscript: '正文' } },
  'pinax.carrier.script': { projectKind: 'screenplay', dataDirs: { script: '剧本' } }
}
export const SKELETONS = {
  novel:      ['正文','大纲','世界书','构思','资料','日志','约束'],
  screenplay: ['剧本','人物','场景','大纲','世界书','资料','日志','约束'],
  generic:    ['文档','资料','日志','约束']
}
```

**关键纪律——不分叉格式**：
- `.pinax/project.json` 必须继续写 `spec: 'pinax-project@3'` / `schemaVersion: 3` / `carriers.primary|enabled|revision`，字段名一个不许改
- 这样 Pinax 桌面端打开 OpenStory 建的库，认得出；反之亦然
- 内核的 `validateProjectDocument` / `nextCarriers` 逻辑照抄（它们是纯函数，约 100 行），不引内核

**保留物**：内核的 `projectSkeleton.mjs`（23 行常量 + 一个 ensureSkeleton）可以留——它是格式定义，且已被 `capabilityGraph` 依赖。本仓的 `SKELETONS` 从它 import 或逐字抄，二者选一，**不能两处各写一份不同的表**。

**验收**：
- 新建库（小说/剧本/空壳三条路）产出的 `.pinax/project.json` 与改造前**逐字节可比**（除 projectId/时间戳）
- 用 Pinax 桌面端打开新库能识别（需作者配合验一次）
- `core/pinax/next/carriers/`、`pluginRegistry.mjs`、`carrierManifest.*`、`capabilityGraph.mjs` 全部删除

**风险**：如果将来要接漫画/视频等其它载体，本仓需要再补表项。**这是有意接受的代价**——OpenStory 目前只服务小说与剧本，让内核背 11 份清单是替不存在的需求付成本。

---

### 第 3 步：pinaxAdapter 收敛层（接触面 26 → 5）

**做法**：新建 `pinaxAdapter.mjs`，成为**唯一允许 import `core/` 的文件**。

```js
// pinaxAdapter.mjs —— 内核能力的唯一出口
export { factStore }        // createFactFileStore / writeFactFile / readFactWiki / FACT_DIR_NAME
export { deduce }           // openDeduceSession / presentTurn / applyDirectorAction / settleChoice
export { enrich }           // derivePseudoChapters / hasRealChapters / causalSummary
export { projectMeta }      // readProjectDocument / writeProjectDocument / nextCarriers / validateProjectDocument
export { projectImport }    // planImport / runImport（用本仓 parseChapterNumber）
```

六个消费者改成 `import { factStore } from './pinaxAdapter.mjs'`，从此**看不到 core/ 路径**。

**为什么这一步值钱**：内核升到 0.17 时，改的是 adapter 里 5 个函数体的适配，而不是散在 6 个模块里的 17 条 import。

**配一条门禁**（扩展现有 `tools/acceptance/acceptance.mjs` 的 S2）：

```
S2.4  只有 pinaxAdapter.mjs 可以 import core/**（其余模块违规即挂）
```

这条规则一旦进 CI，解耦就不会回潮——比任何文档都管用。

---

### 第 4 步（并行）：上游漂移检测

**问题**：`core/VENDORED.md` 只写了「自 Pinax-next@70a4f44」，但**没有任何机制发现上游已变**。作者在 Pinax-next 改内核，OpenStory 这边不会知道。

**做法**：`scripts/check-vendor-drift.mjs`（约 120 行）

```
node scripts/check-vendor-drift.mjs
→ 读 core/*.provenance.json 记录的 upstream commit + sha256 清单
→ 对 D:/Pinax-next 逐文件算 sha256 比对
→ 输出三类：[一致] [上游已改] [本仓被改]
→ 有差异 exit 1，可在 CI 或提交前跑
```

配套：
- `vendor-core.mjs` 在写入时同步生成 `.provenance.json`（每文件一行 sha256）
- **「本仓被改」必须报警**——那是违反 `VENDORED.md` 禁改纪律的直接证据

**验收**：故意在 `D:/Pinax-next` 改一个内核文件，脚本报出来；改回来，脚本安静。

---

## 4. 收益账

| 项 | 现在 | 做完 |
|---|---|---|
| core/ 行数 | 12,551（64 文件） | **约 4,300**（22 文件） |
| 允许 import core 的模块 | 6 个（17 条 import 散落） | **1 个**（pinaxAdapter.mjs） |
| 接触符号 | 26 个 | 5 个能力组 |
| 上游变更发现方式 | 无 | 漂移检测脚本（CI 可挂） |
| 内核反向依赖 | 0 | 0（保持） |
| `.pinax/project.json` 兼容 | 双向 | **双向不变** |

### 明确不做的

- **不重写 fact 存储协议**。2,322 行里最值钱的是 operationId 幂等 + expectedRevision 冲突检测 + revision 自增，自己实现不划算且容易出错。
- **不重写推演端子**。2,013 行是确定性推演的核心算法（同种子＋同事实包＝同一拍），这是 Pinax 的立身之本。
- **不 fork 格式**。所有落盘格式（project.json / 拆解/*.json / .wiki.json）保持 Pinax 口径，这是兼容性的根。
- **不动 `@pinax/core` 的 4 个子路径**。那 1,237 行是 worldbook/lexicon 契约，属格式定义，留着。

---

## 5. 施工顺序与验收

| 步 | 内容 | 预估 | 风险 | 验收 |
|---|---|---|---|---|
| 1 | 章节号自持，删 server 层 | 1 批 | 低 | 纯函数对拍 + 双验证绿 |
| 2 | 建库自持，删载体体系 | 2 批 | 中 | project.json 逐字节比对 |
| 3 | pinaxAdapter 收敛 + S2.4 门禁 | 1 批 | 低 | 门禁通过 + 6 模块改引 |
| 4 | 漂移检测脚本 | 1 批 | 低 | 造假差异能被抓出 |

**每一步都必须过**：`node --test`（314 例）＋ `tools/acceptance`（14 项）＋ 水浒传第一章 10/10 ＋ 新建项目 13/13。

**第 2 步之前需要作者确认一件事**：Pinax 桌面端与 OpenStory 共用 `.pinax/project.json`，改成本仓自持后，请作者用 Pinax 打开一个 OpenStory 新建的库确认能认。这一步不能靠我单方面验证——那是跨仓契约。

---

## 6. 一个提醒

第 2 步砍掉载体体系，等于**接受「OpenStory 不再自动继承 Pinax 新增的载体」**。将来 OpenStory 要支持漫画时，需要在本仓补一条表项，而不是升级内核就自动有了。

反过来说，这也正是解耦的意义：**内核的 11 份载体清单是 Pinax 的产品面，不是 OpenStory 的**。让两个仓各自只背自己的产品面，兼容性才不会被对方的节奏拖累。

如果作者认为「将来一定会支持全部 11 种载体」，那第 2 步应改为「保留载体注册体系，但改为按需动态加载」——那样省不到 3,654 行，但仍是正确方向。这条请作者定。
