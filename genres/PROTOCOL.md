# 体裁与形制注册协议 · openstory-genre@1

> 一份体裁＝一个 JSON 文件，声明「这类作品怎么写、要哪些模块、Agent 用什么策略」。
> 体裁是**项目级一等约束**：建库时选定，写进 `.openstory/brief.json`，决定页签裁剪与 Agent 策略。

## 注册方式（与套件/风格包同口径）

```
genres/<genre-id>.json          ← 内置（随仓）
%LOCALAPPDATA%/OpenStory/openstory/genres/   ← 本机（社区自带，按 id 覆盖内置）
```

内置只提供 **六类**（短故事 / 长篇连载 / 短剧漫剧 / 文学文艺 / 院线电影 / 电视剧），
其中前三类标 `"tier": "primary"`（v1 主打）。**其余形制一律由社区按本协议自备**——这就是
「其他形制的提供好协议规范，开源可自行准备」的落地方式。

## 字段

```jsonc
{
  "schemaVersion": "openstory-genre@1",
  "id": "short-story",
  "name": "短故事",
  "tier": "primary",                       // primary｜extended（仅影响前端默认排序/推荐）
  "summary": "一句话人话说明",
  "deliverables": ["novel"],               // 允许多种：novel｜script｜comic｜game
  "requiredCarriers": ["openstory.carrier.novel"],          // 必需模块（决定建库主载体与页签）
  "optionalCarriers": ["openstory.carrier.notes"],          // 可选模块（默认不建，作者可加）
  "excludedPages": ["worldbook", "wiki"],               // 明确不出的页签（短故事不要世界书/wiki）
  "length": {
    "unit": "chars",                       // chars｜episodes｜minutes
    "total": { "min": 3000, "target": 8000, "max": 20000 },
    "perUnit": null,                       // 分章/分集时每单位篇幅；null＝不分
    "divideBy": "none"                     // chapter｜episode｜scene｜none
  },
  "structure": {
    "numbering": null,                     // "NNN-标题" 之类；null＝不分
    "chapterHook": false                   // 是否强制章末钩
  },
  "agentPolicy": {
    "pacing": "一段式张力曲线：开头三句定生死，中段单冲突递进，结尾回扣开头。",
    "openHook": "前 200 字必须出冲突或异常，不铺世界观。",
    "reviewFocus": ["开头是否抓人", "是否存在无效铺垫"],
    "forbidden": ["世界观说明书式开篇", "章末总结升华"]
  },
  "knowledgePacks": [],                    // 知识包引用（L4 装配时按 fact 块注入）
  "compatStyles": ["*"]                    // 兼容风格包层（tags.genre 匹配；* ＝全兼容）
}
```

## 硬约束（宿主校验）

- `id` `[\w-]{1,40}`；`schemaVersion` 精确匹配（不做半懂兼容）；
- `deliverables` 只收 `novel/script/comic/game`；
- `requiredCarriers` 必须是已知载体 id（`openstory.carrier.*`）；
- `length.unit` 与 `divideBy` 联动：`divideBy:"chapter"` 时 `perUnit` 必须给区间；
- 缺字段＝用宿主缺省（`length` 缺省不分章、`agentPolicy` 缺省不额外注入）。

## 项目简报（openstory-brief@1）

体裁选定的产物，落 `库根/.openstory/brief.json`：

```jsonc
{
  "schemaVersion": "openstory-brief@1",
  "genre": "short-story",
  "deliverables": ["novel"],
  "length": { "unit": "chars", "total": 8000, "perUnit": null, "divideBy": "none" },
  "createdAt": "2026-11-16T…",
  "updatedAt": "2026-11-16T…"
}
```

简报是**第一等约束**：Agent system prompt 会注入 `agentPolicy` 与篇幅目标；页签按
`requiredCarriers ∩ 库内实际目录` 裁剪；套件可声明 `capabilities.genres` 与之匹配推荐。
