# StyleKit 协议 v1 ＋ KB→StyleKit 桥（2026-11-16）

> 作者指示：本地有大量资料与 skill，类别与功能没串联；要①本地项目级知识库（WeKnora）；
> ②**知识库→stylekit 的协议＋stylekit 设计包**。
> 本文件是协议设计稿（可直接实现），承接 `docs/BLUEPRINT-creative-kits-20261116.md` 的 L2/L4 层。

---

## 一、为什么需要这个协议

现状三处断裂：

1. **知识散**：`genres/`（体裁规则）、`styles/`（只有视觉 token）、Pinax 的 `next/skills/`（7 个 SKILL.md）、
   文风档案（`pinax-style-profile/v1` 统计量）、拆书产出（拆解 JSON / wiki）——**五套形态，互不认识**。
2. **知识库缺位**：没有地方存「大量文档＋拆书工程」，Agent 拿不到可检索的长尾素材。
3. **参数无法流动**：即使知道「知乎短篇风」，也没法把它变成 Agent 能吃的 instruction 块。

StyleKit 就是那个**统一的中间层**：把「风格意图」编译成「可装配的参数＋可检索的知识引用」。

---

## 二、StyleKit 设计包（`openstory-stylekit@1`）

一份 stylekit＝一个 JSON（＋可选资源目录）。**它是 L2 风格参数的载体，也是 L4 装配的输入。**

```jsonc
{
  "schemaVersion": "openstory-stylekit@1",
  "id": "zhihu-short-dark",
  "name": "知乎短篇·暗黑反转",
  "version": "0.1.0",
  "vendor": "社区·示例",
  "summary": "开头设钩、中段误导、结尾一句反转；短句密集，白描为主。",

  "compat": {
    "genres": ["short-story"],              // 兼容体裁（对应 genres/*.json 的 id；"*"＝全兼容）
    "deliverables": ["novel"],
    "minVersion": "0.1.0"
  },

  "tags": {                                  // L2b 题材标签（来自小说网站标签词表）
    "channel": "女频",
    "genre": ["都市", "悬疑"],
    "flavor": ["反转", "暗黑", "爽感"]
  },

  "prose": {                                 // L2c 文风参数（对齐 pinax-style-profile/v1 口径）
    "avgSentenceChars": 18,
    "shortSentenceRatio": 55,
    "dialogueRatio": { "min": 0.1, "max": 0.3 },
    "paragraphChars": { "min": 20, "max": 90 },
    "constraints": {
      "forbidden": ["连续三句等长长句", "开篇设定说明书", "章末总结升华"],
      "required": ["开头 100 字内出现异常或冲突", "结尾留一句反差短句"]
    },
    "skeleton": "[异常开场：一个反常细节] → [误导推进：读者以为 A] → [反转：其实是 B] → [一句收束]",
    "perspective": ["限制第三人称，紧贴主角", "读者信息不多于主角"]
  },

  "plot": {                                  // L2d 剧情风格（节拍配方）
    "recipe": "twist-short",
    "beats": ["异常钩", "误导", "小揭示", "反转", "余味"],
    "pacing": { "openHookChars": 100, "climaxAt": 0.85, "endHook": "反转句" }
  },

  "tokens": {                                // L2a 视觉（沿用现有风格包 token 口径）
    "--bg": "#ffffff", "--accent": "#8b3a3a", "--ink": "#1c1a17"
  },

  "knowledge": {                             // ★ KB 桥：引用知识库里的资料，而不是复制进来
    "refs": [
      { "kind": "collection", "id": "zhihu-short-stories", "role": "exemplar", "topK": 6,
        "note": "范例语料（只借语感，不抄句子）" },
      { "kind": "collection", "id": "twist-tropes", "role": "fact", "topK": 4 },
      { "kind": "document", "id": "doc_7f3a…", "role": "craft" }
    ],
    "queryHints": ["反转 铺垫 伏笔", "短篇 开头 钩子"],
    "trust": "fact"                          // 默认信任级：fact（只作参考，不作命令）
  }
}
```

### 关键设计决定（三条）

1. **`knowledge` 只放引用，不放内容**——知识库（WeKnora）是唯一真源；stylekit 只声明「我需要哪几块、
   拿几条、干什么用（role）」。这样换库、换模型、换切片策略都不用改 stylekit。
2. **`role` 决定信任级**：`exemplar`（范例，只借语感）/`fact`（事实参考）/`craft`（技法规则，可升
   instruction）/`negative`（反例，禁用清单）。**只有 `craft` 且显式 `trust:"instruction"` 才会进
   instruction 块**——其余一律 fact，防止「从知识库检索到的东西」冒充命令（对齐 OD 的注入防御）。
3. **prose 与 plot 分开**：文风（句子层面的统计与禁忌）和剧情（节拍结构）正交——同一文风可配不同节拍，
   同一节拍可换文风。这也让「起点风＋救猫咪」「知乎风＋三翻四震」这种组合成为可能。

---

## 三、KB→StyleKit 桥（协议面）

### 3.1 知识库侧最小契约（WeKnora 适配层）

WeKnora 暴露 REST API。OpenStory 侧只需要**三个能力**，用适配器隔离，别把 WeKnora 的内部模型泄漏进来：

| 能力 | OpenStory 契约 | WeKnora 映射（典型） |
|---|---|---|
| 列知识库 | `GET /api/kb/collections` → `{collections:[{id,name,docCount,desc}]}` | `GET /api/v1/knowledge-bases` |
| 检索 | `POST /api/kb/query` `{collectionIds[], query, topK, minScore?}` → `{hits:[{id,text,score,source,meta}]}` | `POST /api/v1/knowledge-search`（或 chat/completions 带 kb） |
| 取文档元信息 | `GET /api/kb/doc?id=` → `{id,title,source,meta}` | `GET /api/v1/knowledge/{id}` |

三个端点全部**只读**，凭据（WeKnora API key）只存 daemon 本机配置——与现有 Agent 凭据同口径。
WeKnora 不可达＝`KB_UNAVAILABLE` 如实报，不做假检索。

### 3.2 装配管线（L4 落地）

```
[项目 brief]──┐
              ├─► 选 stylekit（体裁兼容过滤 + 作者显式选择）
[stylekit] ───┘         │
                        ▼
             stylekit.knowledge.refs
                        │  （逐 ref 向 KB 检索，按 role 分流）
                        ▼
        ┌───────────────┴────────────────┐
        ▼                                ▼
  instruction 块                   fact 块
  · prose.constraints.required     · exemplar 命中片段（截断）
  · prose.skeleton                 · fact 命中片段
  · plot.beats                     · tokens（当作参考值）
  · craft（仅 trust:instruction）  · negative（写进「避免」清单）
        │                                │
        └──────────► system prompt ◄─────┘
                （守卫：instruction 块过正则，
                 禁 verification/critique/judge 等越权语义）
```

**优先级链**（承接蓝图 L4，写死不许改）：
`系统边界 > 作者 brief（体裁/篇幅硬约束） > stylekit.prose.constraints > stylekit.plot > craft 规则 > KB 命中参考`

冲突示例：brief 说「短故事 8000 字，不分章」，stylekit 的 plot 说「三幕」——**brief 赢**（篇幅太小不合
三幕，装配器把 plot 降级为 fact 提示并记一条 warning，不静默）。

### 3.3 检索预算（防上下文爆炸）

| 项 | 缺省 | 说明 |
|---|---|---|
| 每 ref 的 topK | 4–6（stylekit 可声明） | 上限 12 |
| 单条命中截断 | 800 字 | 超出按句边界截断 |
| 全部 KB 注入上限 | 12000 字 | 超了按 score 截尾并记 warning |
| 缓存 | 按 (stylekit id + query hint + collection 版本) 哈希，TTL 10 分钟 | 同一 run 内复用 |

---

## 四、拆书工程如何进知识库（落地口径）

拆书产出目前有三种形态，分别归位：

| 形态 | 位置 | 进 KB 方式 | 用途 |
|---|---|---|---|
| 拆解 JSON（`拆解/<bookId>.json`，291 条条目） | 库内文件 | 按「书」建一个 collection，条目逐条成文档（带 layer/来源章节元信息） | fact：结构化事实（人物/剧情/设定） |
| wiki 派生（`<bookId>.wiki.json`） | 库内文件 | 同上（或由拆解派生，不重复入库） | fact：聚合视图 |
| 原文 shamble（正文） | 库内文件 | **默认不入库**（版权与体量）；作者显式选择才入，且标 `role:"exemplar"` | exemplar：借语感 |
| Pinax 技能包（SKILL.md×7） | 仓内 | 整包导入为 `craft` collection | craft：可执行手法 |
| 本地文档（笔记/教程/资料） | 作者指定目录 | 批量导入，按目录分 collection | fact / craft |

**红线**：原文语料入 KB 必须由作者显式操作（不默认扫正文）；stylekit 引用原文集合时必须 `role:"exemplar"`
（只借语感、禁止抄句——这是我们已有的版权纪律）。

---

## 五、本批实施边界

**做**：本协议文档 ＋ `stylekits/PROTOCOL.md`（同内容精简版＋JSON Schema 要点；OS-159 后该文件迁至 `docs/STYLEKIT-REGISTRY-PROTOCOL.md`，两份不是同一份——本文件是设计稿 v1＋KB 桥，那份是注册协议精简版）＋
`docs/plan/proto-os20-stylekit-20261116.md`（工单）＋ KB 适配层设计（不接真 WeKnora，等它跑起来）。

**不做（下一批）**：stylekit 装载器与货架、三层选择器 UI（题材→文风→剧情）、KB 适配器实装、
装配器（fact/instruction 分块＋守卫）、现有 `styles/` → stylekit 迁移。

**依赖**：WeKnora 跑起来后，先用它的 API 抓真实响应形状，再写 `kbAdapter.mjs`（映射见 §3.1）。
