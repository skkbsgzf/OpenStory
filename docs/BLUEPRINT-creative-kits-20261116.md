# 创作 Kit 层级盘点 ＋ 知识统合蓝图（2026-11-16）

> 作者指示：盘点创作 kit 的层级与前端交互问题；体裁/形制定为项目级一等约束；Preset 后续换风格包；
> 知识体系按 OpenDesign 的四层思路（分库→选择→装配→冲突仲裁）提前做蓝图，逐步迭代。

---

## 一、盘点：我们已有的资产（真实清点，非设想）

### 1.1 OpenStory 仓（D:\OpenStory，本仓）

| 层 | 资产 | 现状 | 问题 |
|---|---|---|---|
| 业务套件 | `suites/{writing,screenwriting,comicdrama}`（openstory-suite@2） | 写作@0.1 两处真实接线（默认章标题/推演分支数）；另两套占位声明 | **套件只声明 settings，没有 stage/module 声明**——套件与「体裁形制」没有接口 |
| Agent 运行时 | `runtimes/{echo-kit, cli-codebuddy, cli-qoder, cli-claude, dsh}` | 三层可插拔已通（Pi 默认/CLI 嫁接/DSH 探测） | 运行时不知道「这是什么体裁的作品」——策略注入只有一条通用 system prompt |
| 外观包 | `styles/{coral,ink,night}.json`（tokens） | 整窗换肤＋栅格令牌 | 纯视觉 token，**没有文风/剧情参数**——Preset 的语义在这层缺失 |
| 底座 | `core/`（载体清单 11 份＋建库内核） | 建库只用 projectKind/dataDirs | 载体=目录维度；**没有「该载体对本体裁是否必要」的判定** |
| 前端页签 | 产物｜正文｜世界书｜大纲｜构思｜资料｜约束｜剧本｜人物｜场景｜…｜Wiki｜推演 | **按库实际目录出**（OS-8） | 页签是「目录镜像」而非「体裁规划」——短故事库里只要有一个 `世界书/` 空目录也会出页签 |

### 1.2 Pinax 仓（可 vendor / 借鉴）

| 资产 | 位置 | 可复用性 |
|---|---|---|
| 11 载体清单（novel/script/comic/worldbook/outline/notes/dossier/material/video/experience/online） | `next/carriers/*/manifest.mjs` | 已 vendor 进 core/；载体＝目录认领，可直接当「形制→模块」映射源 |
| 7 个创作技能包（SKILL.md） | `next/skills/{chapter-rewrite, continuity-check, fact-consistency, fact-extract, outline-restructure, scene-expand, worldbook-refactor}` | **技能配方**：每个带 name/description；可整包 vendor 成 `skills/` 货架，是「选择→装配」的现成输入 |
| 文风档案（统计量级） | `next/fact/packs/novel-style-profiles/异兽迷城-彭湃.json`（pinax-style-profile/v1） | **文风参数的黄金样本**：avgSentenceChars / shortSentenceRatio / dialogueRatio 区间 / forbidden / required / skeleton / perspective.rules。只含统计量与短约束，无原文 prose（版权红线已守） |
| 知识内核 runtime | `D:\Pinax-core`（@pinax/core 0.16.0） | 底座抽取目标；本章不接 |
| fact 引擎 / 推演链 / RAG | `next/fact/**`（S1/S2/S4 已用） | 事实库与 wiki 派生已在 OpenStory 用到；推演接引擎是独立工单 |

### 1.3 缺口清单（这份盘点最有价值的部分）

1. **体裁与形制不是一等公民**：库里只有目录，没有「这是什么体裁、交付什么、多长、分不分章」的项目级声明。
   → 后果：页签无法裁剪、Agent 没有篇幅策略、套件不知道自己在服务谁。
2. **套件与体裁无接口**：套件声明的是 settings 键值，没有「我服务哪些体裁/哪些阶段/装配哪些模块」。
3. **Preset 语义缺失**：现有 `styles/` 只有视觉 token；题材标签（男女频/修仙/都市/玄幻）、文风参数
   （起点/番茄/知乎短篇/严肃文学/自定义蒸馏）、剧情风格（悬疑递进/救猫咪/英雄叙事/日漫/短篇复仇/三翻四震）
   三层完全空缺。
4. **技能包未入货架**：Pinax 的 7 个技能包（SKILL.md 形态）在 OpenStory 没有装载点。
5. **知识装配无信任分级**：Agent 上下文目前只有「一条通用 system prompt＋会话历史」，没有 OD 那种
   `fact`/`instruction` 分块与优先级链——外部资源一进上下文就等于都能当命令，这是安全问题也是质量问题。

---

## 二、蓝图：创作 Kit 的四层（我们的分层）

```
L0 项目约束（第一等）  体裁 × 交付物 × 篇幅 × 分章/分集   ← 本批实现（OS-19）
      │ 决定下面每一层「装什么、裁什么」
L1 形制与模块          该体裁必需的载体/工作面（世界书/wiki/大纲/分集/章节…）
      │
L2 风格参数（三层）    题材标签 → 文风参数 → 剧情风格          ← 协议先立，逐批填库
      │
L3 技能配方（skills）  可执行手艺（改写/扩写/一致性/抽取/重构…）
      │
L4 装配与仲裁          OD 同构：fact/instruction 分块 + 优先级链 + 缓存分层
```

### 2.1 L0 项目约束：体裁 × 形制（本批落地）

**体裁（genre）**——决定节奏与篇幅策略：

| 体裁 | 交付物 | 篇幅单位 | 分章/分集 | 必需模块 | Agent 策略要点 |
|---|---|---|---|---|---|
| 短故事 | 小说 | 单篇 3k–20k 字 | × | 正文（+构思） | 一段式张力曲线，开头三句定生死，不铺世界观 |
| 长篇连载 | 小说 | 单章 2k–4k 字 | 分章 | 正文+大纲+**世界书+wiki**+构思+约束 | 章末钩子、伏笔台账、连续性核对、事实库增量抽取 |
| 短剧漫剧 | 剧本+漫画 | 单集 60–120 秒≈1.5k–3k 字 | 分集 | 剧本+人物+场景+大纲 | 每集单冲突单反转，画面可拍性优先于文字美感 |
| 文学文艺 | 小说 | 单篇/单章不限 | 可选 | 正文+构思 | 允许慢、允许暧昧；禁强行钩子；语言密度优先 |
| 院线电影 | 剧本 | 90–120 分钟≈25k–40k 字 | 分场 | 剧本+人物+场景+大纲 | 三幕/救猫咪节拍、场景目标-障碍-转折 |
| 电视剧 | 剧本 | 单集 40–60 分钟 | 分集 | 剧本+人物+场景+大纲+世界书 | 集末钩、A/B 线并行、人物弧跨集 |

**交付物（deliverable）**：剧本 / 小说 / 漫画 / 游戏。一份体裁可允许多种（短剧漫剧＝剧本+漫画），
初始化时选定，决定落盘目录（`正文/` vs `剧本/` vs `漫画/`）。

**篇幅（lengthTarget）**：`{ unit: 'chars'|'episodes'|'chapters', total?, unitChars: {min,target,max} }`。
**结构（structure）**：`divideBy: 'chapter'|'episode'|'scene'|'none'`＋编号规则。

这三样一起写进**项目级`.openstory/brief.json`**（`openstory-brief@1`），是项目的第一等约束：
- 页签按「体裁必需模块 ∩ 库内实际目录」裁剪（短故事不出 worldbook/wiki 页签）；
- Agent system prompt 增补体裁策略段（篇幅/节奏/章末钩/审查重点）；
- 套件可声明服务哪些体裁（`capabilities.genres`），初始化时自动建议启用。

### 2.2 L2 风格参数：三层协议（Preset → 风格包）

**关键裁定：Preset 退役，统一成「风格包」，但风格包分三层参数**，不再只是视觉 token：

```jsonc
// styles/<id>.json —— 扩到 openstory-style@2
{
  "schemaVersion": "openstory-style@2",
  "id": "xianxia-cool",
  "name": "修仙·冷硬",
  "layers": {
    "tokens":   { "--bg": "#fff", "--accent": "#3a6b8f", … },   // L2a 视觉（现有）
    "tags":     { "channel": "男频", "genre": "修仙", "flavor": ["宗门", "冷酷主角"] },  // L2b 题材
    "prose":    { "avgSentenceChars": 22, "shortSentenceRatio": 45, "dialogueRatio": [0.15,0.35],
                  "forbidden": ["连续三句等长长句"], "required": [],
                  "skeleton": "…", "perspective": ["紧贴主角限制第三人称"] },        // L2c 文风（对齐 pinax-style-profile/v1）
    "plot":     { "recipe": "three-act", "beats": ["钩子","升级","反转","三翻四震"],   // L2d 剧情风格
                  "pacing": { "openHookChars": 300, "chapterEndHook": true } }
  },
  "knowledgePacks": ["worldbook/xianxia-terms", "trope/cultivation-ladder"],  // 知识包引用（L3 装配时注入）
  "compat": { "genres": ["长篇连载","短故事"] }   // 与 L0 的兼容声明
}
```

三层的选择器（前端交互）：
1. **题材标签**：从小说网站标签词锁（男频/女频 × 修仙/都市/玄幻/悬疑/…）——选标签＝自动筛出兼容风格包；
2. **文风参数**：起点 / 番茄 / 知乎短篇 / 严肃文学 / 自定义蒸馏——「自定义蒸馏」＝对作者本地语料跑统计量
   （复用 pinax-style-profile/v1 的 derivation 口径，样本不入仓）；
3. **剧情风格**：悬疑递进 / 救猫咪 / 英雄叙事 / 日漫 / 短篇复仇 / 三翻四震——存 beat 序列＋节奏参数。

**为什么必须分三层**：视觉能被色板随手切，文风/剧情一旦混在 tokens 里就没法按「体裁兼容」筛，
也没法给 Agent 单独注入「只用 probse 层」。三层各自可独立继承（同主题材可共用 prose）。

### 2.3 L4 装配与冲突仲裁（抄 OD 的骨架）

OD 的四层我们照抄机制，换掉内容域：

| OD | OpenStory |
|---|---|
| 分库：design-systems/skills/design-templates/memory/craft | 分库：`genres/`（体裁形制）·`styles/`（三层风格）·`skills/`（技能配方）·`knowledge/`（知识包）·`brief.json`（项目约束） |
| 装配：全部打成 `<od-next-context kind="fact|instruction">` 块 | 全部打成 `<openstory-context kind="fact\|instruction" name="…">` 块 |
| `fact`＝只能引用；`instruction`＝可执行但先过守卫 | 同：knowledge packs/tokens/示例＝fact；技法规则/文风约束/brief 策略＝instruction，过正则守卫（禁 verification/critique 类越权语义） |
| 缓存分层：头部跨任务字节一致，资源全进 per-run 尾部 | 同：system 骨架＋体裁策略段（按 genre 分桶缓存）＋每 run 的 brief/风格/技能拼尾部 |
| 仲裁链：系统边界 > 用户显式请求 > 品牌 token > craft 用法 > 模板参考 | 仲裁链：**系统边界 > 作者显式请求（brief） > 体裁形制（篇幅/分章硬约束） > 风格包 prose/plot 参数 > 技能配方 > 知识包/示例参考** |

一句人话：**brief 管「写多长、怎么分」，体裁管「要不要世界书」，风格包管「用什么笔法和节奏」，
技能管「这一步怎么干」，知识包只提供参考不提供命令。**

---

## 三、前端交互问题清单（现状盘点结论）

| # | 问题 | 现状 | 建议 |
|---|---|---|---|
| 1 | 建库只选主模块，不问体裁/篇幅 | 新建流只有「位置＋库名＋主载体」 | **加一步「作品简报」**（体裁/交付物/篇幅/是否分章分集）——本批做 |
| 2 | 页签是目录镜像，不按体裁裁剪 | 空目录也出页签 | 页签＝体裁必需模块 ∩ 实际目录 |
| 3 | Agent 不知道作品体裁 | 通用 system prompt | brief → 体裁策略段注入（篇幅/章末钩/审查重点） |
| 4 | 色板只有视觉 | 三套 tokens | 色板升级「风格包」选择器：题材标签筛选 → 三层预览 → 兼容提示 |
| 5 | 套件不知服务谁 | 套件只有 settings | 加 `capabilities.genres[]` 声明，建库时自动建议 |
| 6 | 技能包无法选 | 无装载点 | `skills/` 货架（SKILL.md），推演/写作流程里按阶段挂 |
| 7 | 知识包无信任分级 | 无 | L4 装配块（fact/instruction）＋守卫 |

---

## 四、本批实施边界（OS-19）

**做**：体裁库 `genres/*.json`（6 体裁全量声明，主打三种标 `tier: primary`）＋交付物 4 类＋
`openstory-genre@1` 协议＋项目简报 `.openstory/brief.json`（`openstory-brief@1`）＋3 端点
（genres/brief get/put）＋新建流加「作品简报」步＋Agent system prompt 注入体裁策略＋页签按体裁裁剪。

**不做（后续批次）**：风格包三层协议实现（本批只立协议文本 `styles/PROTOCOL.md`）、技能包货架、
知识包与 L4 装配器、Preset 迁移。

**开源协议承诺**：6 体裁全部以数据文件声明（非代码），社区可自带 `genres/<id>.json` 丢本机目录——
「主打三种之外的其他形制提供协议规范，开源可自行准备」由此落地。
