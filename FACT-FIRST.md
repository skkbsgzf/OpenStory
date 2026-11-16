# FACT-FIRST · 事实链数据体系声明

> OpenStory 的一级公民：**事实链（fact）优先于正文（prose）**。
> 本文件是硬约定，不是建议。任何读数据、喂模型、做推演、改文档的代码路径，都必须先过这里。

---

## 一、优先级（唯一顺序）

```
① 事实链  fact entries（事件/人物/设定/关系/因果图/需求层级/台账）
② 正文    chapters（.md 原文）
③ 派生物  wiki 快照 / RAG 索引 / 推演会话（都由 ① ② 生成，不构成独立真源）
```

**为什么正文是第二优先级**：正文是非结构化文本，喂给模型时无处不在地膨胀上下文、无法判定一致性、无法定位证据。
事实链是**正文的规范化投影**——每个事件条目带 `sources[]`（源文件＋段号＋quote_hash），可以随时回到正文逐字核对。
所以：**读正文之前先问「事实链里有没有」；喂模型之前先问「能不能只喂事实链」**。

**唯一的例外**：作者显式要求看原文（阅读、逐字引用、风格模仿的对照片段）。这时读正文，但结论必须能回指事实链条目。

---

## 二、事实链是什么（数据契约）

一条 fact 条目（`core/pinax/next/fact/domain/schema.js` 校验）：

| 字段 | 含义 |
|---|---|
| `id` | 稳定 ID（`stableEntryId(layer,domain,slot,name)`，跨重建零漂移） |
| `layer` | `plot` / `character` / `world` |
| `name` | 条目名（人物名 / 事件名 / 设定名） |
| `events[]` | 事件：`who` / `channel`（do/say/think/feel/perceive/state/event）/ `content`（**逐字原文切片**）/ `segments[]` |
| `sources[]` | 溯源：`sourceId` / `segmentId` / `quote_hash` |
| `validity` | 章节范围 `{from,to}` |
| `relations[]` | 实体关系 |
| `status` | `fact` / `proposed`（假设） |

**派生层（本仓新增，也是事实链的一部分）**：

| 产物 | 位置 | 内容 |
|---|---|---|
| 六槽位语义 | `<id>.wiki.json` 的 `slots` | gimmick / plotDesign / intro / style |
| 因果图 | `wiki.causalGraph` | `nodes[{id,chapter,event,kind}]` / `edges[{from,to,type,strength,evidence}]` / `threads[{name,chapters,closed}]` |
| 需求层级 | `wiki.characterProfiles[].needs` | `{level 1-5, need, object, fear, cost, evidence}` |
| 状态台账 | `wiki.ledger` | `knowledgeLedger`（谁知道什么）/ `stateLedger`（关键物终局） |
| 世界要素 | `wiki.worldElements` | `scenes[]` / `items[]` |
| 章纲 | `wiki.chapterSummaries[]` | `{chapter,title,summary,function,emotion,beats}` |

---

## 三、硬规则（代码级）

### 规则 1：事实链是唯一的结构化读取通道

```js
// ✓ 正确：走 factFileStore
import { createFactFileStore } from './core/pinax/next/kernel/factFileStore.mjs'
const store = createFactFileStore({ root })
const { entries } = await store.list({ layer: 'plot' })

// ✗ 错误：自己拼路径读 .pinax/extractions/*.json
```

### 规则 2：喂模型前，事实链优先、正文兜底

上下文装配顺序固定：

```
1. 从 fact 取：在场人物卡（含 needs）、当前章事件流（逐字）、知情台账、在途伏笔、因果边
2. 若 fact 缺该章（未拆解）→ 降级读正文，并在结果里标注 degraded: true
3. 绝不在 fact 可用时读全文正文
```

### 规则 3：事实链缺失必须如实降级，不许假装

| 情况 | 行为 |
|---|---|
| 库内没有 extraction 文件 | 返回 `FACT_EMPTY`，由调用方决定降级读正文 |
| 有 fact 但该章无条目 | 返回 `FACT_PARTIAL`（带已覆盖章列表） |
| 有 fact 但因果图为空 | 推演时 `useCausal: false`，不静默忽略 |

**禁止**：把「没有事实链」当成「没有数据」而静默改用正文，让调用方以为用的是 fact。

### 规则 4：任何结论都要能回指

推演、问答、Wiki 生成的输出，凡涉及"发生了什么/为什么"的判断，必须带：

```json
{ "claim": "…", "evidence": [{ "entryId": "…", "chapter": 6, "quoteHash": "…" }] }
```

拿不到 evidence 的结论标 `unverified`，不进最终交付。

### 规则 5：正文写入不触发事实链自动更新（刻意）

`chapterPut` 只改 `.md`。事实链重建是显式动作（`/api/enrich/run` 或抽取管线），
因为重建要跑模型、要花钱、要人确认。**不要让正文编辑隐式触发重建**——那会让作者每按一次保存都在等模型。

但要在 `chapterPut` 的响应里带 `factStale: true`（当该书已有 fact 且正文 mtime 比 fact revision 新），提示 UI 显示「事实链已过期」。

---

## 四、现有模块审计结果

| 模块 | 数据来源 | 合规 | 备注 |
|---|---|---|---|
| `deduceEngine.mjs` | `createFactFileStore` → `entries` | ✅ | 注释已写「与 /api/entries 同源」 |
| `daemon.mjs` `entries`/`entry` | fact 通道 | ✅ | 只读端点 |
| `daemon.mjs` `chapterGet`/`chapterPut` | 正文 `.md` | ⚠️ | 合理（正文 CRUD），但需加 `factStale` 标记 |
| `daemon.mjs` `chaptersGet`/`chaptersCreate`/`chaptersRename`/`chapterDelete` | 文件名清单 | ✅ | 只管章节文件层，不涉及内容语义 |
| `kbAdapter.mjs` | 上传文档到 WeKnora | ⚠️ | 上传源应为 fact 导出的知识目录（`export-rag`），不是正文原文 |
| `agentStore.mjs` / `dsh-bridge.mjs` | 会话 JSONL | ✅ | 对话历史，与事实链正交 |
| `wikiDerive.mjs` | 由 fact 派生 wiki | ✅ | 正确方向 |
| **缺** | 六槽位/因果图/需求/台账 | ❌ | 这些只在 Pinax-next devtools，未进 core/ |

---

## 五、待接入（本声明之后要做的）

1. **`enrichEngine.mjs`**：把六槽位＋因果图＋需求层级＋台账采集封装进 core/，暴露 `POST /api/enrich/run` 与 `GET /api/enrich/graph`。
2. **推演注入因果**：`deducePresent` 增加 `useCausal`，读 `causalGraph` 后把「断哪条边影响几章」喂进 sceneContext。
3. **RAG 导出口径**：`kbAdapter` 的上传源改为 `export-rag` 产出的知识目录（人物卡/事件卡/场景/道具/台账），不再直接传正文。
4. **`factStale` 标记**：`chapterPut` 响应加该字段，UI 显示事实链过期提示。

---

## 六、一句话

> **事实链是这本书的结构化记忆；正文是它的原始出处。**
> 记忆优先，出处兜底；记忆可回指出处，出处不替代记忆。
