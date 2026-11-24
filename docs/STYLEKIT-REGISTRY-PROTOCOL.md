# StyleKit 注册协议 · openstory-stylekit@1

> 一份 stylekit ＝ 一个 JSON，声明**风格意图**（题材标签 / 文风参数 / 剧情节拍 / 视觉 token）
> 与**知识库引用**（「我需要哪几块知识、拿几条、干什么用」）。知识内容不进 stylekit，只放引用。

## 注册方式（与套件/体裁/风格包同口径）

```
stylekits/<id>.json                                  ← 内置
%LOCALAPPDATA%/OpenStory/openstory/stylekits/        ← 本机（社区/个人，按 id 覆盖内置）
```

## 必填与可选

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | ✓ | 精确 `openstory-stylekit@1` |
| `id` / `name` / `version` | ✓ | version 三段数字；vendor 为归属（社区自报） |
| `compat.genres` | ✓ | 兼容体裁 id 列表（`genres/*.json` 的 id；`["*"]`＝全兼容） |
| `compat.deliverables` |  | 交付物过滤（novel/script/comic/game） |
| `tags` |  | `{ channel, genre[], flavor[] }`——题材标签（小说站标签词表） |
| `prose` |  | 文风参数：句长/短句率/对话占比区间、`constraints.{required,forbidden}`、`skeleton`、`perspective[]` |
| `plot` |  | 剧情配方：`{ recipe, beats[], pacing{ openHookChars, climaxAt, endHook } }` |
| `tokens` |  | 视觉 CSS 变量（沿用现有风格包口径） |
| `knowledge` |  | `{ refs:[{kind:"collection"\|"document", id, role, topK?, note?}], queryHints[], trust? }` |

## `knowledge.role` 决定信任级（安全关键）

| role | 含义 | 进哪个块 |
|---|---|---|
| `exemplar` | 范例语料（**只借语感，禁止抄句**） | fact |
| `fact` | 事实参考（设定/资料） | fact |
| `craft` | 技法规则（可执行手法） | instruction（需 `trust:"instruction"` 显式） |
| `negative` | 反例 | 写进「避免」清单 |

**默认 fact**。知识库检索到的一切默认只能被引用、不能被当作命令执行——这是注入防御。

## 优先级链（装配时写死）

```
系统边界  >  作者 brief（体裁/篇幅硬约束）  >  stylekit.prose.constraints
        >  stylekit.plot  >  craft 规则  >  KB 命中参考
```

brief 与 stylekit 冲突时 brief 赢，装配器把冲突项降级并记 warning（不静默）。

## 最小示例

```json
{
  "schemaVersion": "openstory-stylekit@1",
  "id": "zhihu-short-dark",
  "name": "知乎短篇·暗黑反转",
  "version": "0.1.0",
  "vendor": "社区·示例",
  "summary": "开头设钩、中段误导、结尾一句反转。",
  "compat": { "genres": ["short-story"], "deliverables": ["novel"] },
  "tags": { "channel": "女频", "genre": ["都市", "悬疑"], "flavor": ["反转", "暗黑"] },
  "prose": {
    "avgSentenceChars": 18, "shortSentenceRatio": 55,
    "dialogueRatio": { "min": 0.1, "max": 0.3 },
    "constraints": {
      "required": ["开头 100 字内出现异常或冲突", "结尾留一句反差短句"],
      "forbidden": ["连续三句等长长句", "开篇设定说明书"]
    },
    "skeleton": "[异常开场] → [误导推进] → [反转] → [一句收束]",
    "perspective": ["限制第三人称，紧贴主角"]
  },
  "plot": { "recipe": "twist-short", "beats": ["异常钩", "误导", "小揭示", "反转", "余味"],
            "pacing": { "openHookChars": 100, "climaxAt": 0.85, "endHook": "反转句" } },
  "knowledge": {
    "refs": [{ "kind": "collection", "id": "zhihu-short-stories", "role": "exemplar", "topK": 6 }],
    "queryHints": ["反转 铺垫 伏笔"]
  }
}
```

## 与旧风格包的关系

`styles/*.json`（只有 tokens）是 stylekit 的**降级子集**：迁移＝把 tokens 搬进 `stylekit.tokens`，
再补 `compat/prose/plot`。迁移期两者并存（stylekit 优先，没有则退回旧风格包）。
