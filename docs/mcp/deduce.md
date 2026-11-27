# 确定性推演与富化域

确定性推演消费故事源 fact，以种子化 2d6 生成局面卡与候选拍包；同一种子、同一操作序列可复现。LLM 不是拍循环的必需环节。富化则从事实链重算旁挂 wiki（实体关系、因果、需求层级等），两者都不替代事实主档写入。

## 工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_deduce_present` | `root` | 出局面卡与候选拍包；`bookId/pov/seed` 可选 | create；`reset:true` 时 restore |
| `openstory_deduce_settle` | `root` | 结算候选或导演动作；传 `action` 与 `candidateId`，`bookId/note` 可选 | create |
| `openstory_enrich_run` | `root,bookId` | 启动全量语义富化，立即返回 `jobId`；需模型运行时 | create |
| `openstory_enrich_status` | `jobId` | 轮询富化任务状态 | read |
| `openstory_enrich_graph` | `root,bookId` | 读富化产出的实体、关系与因果等 wiki 图谱 | read |
| `openstory_fact_curve` | `root` | 读章级剧情曲线；`bookId` 可选 | read |

## 确定性推演拍循环

```text
openstory_deduce_present {root,bookId?,seed?,confirm:"create"}
  → round / sceneCard / candidates

openstory_deduce_settle {root,bookId?,candidateId,action:"choose",confirm:"create"}
  → 结算结果

再次 openstory_deduce_present → 下一拍
```

- `seed` 用于复现或对比同一初态下的不同候选。正常 `present` 与 `settle` 都会保存推演会话状态，都是 create 级写调用，不能省略 `confirm`。
- `reset:true` 会清掉当前局面、从第一拍重来，必须传 `confirm:'restore'`。级别不足返回 `isError:true` + `CONFIRM_REQUIRED`；这是业务确认失败，不是 `-32602`。
- `settle` 的产物只交回调用方，不自动写正文、世界书或 fact 主档。要把候选沉淀为合法事实，按 [fact.md](fact.md) 的整份替换协议执行；要写成正文或世界书，走各自写工具。
- `WORLD_EMPTY` 表示该事实书没有可用世界事实。先用 `openstory_fact_books` / `openstory_fact_entries` 核对并写入合法 fact；enrich 消费事实，不能用它填出一个空主档。

## 富化

`openstory_enrich_run` 做全量重算：六槽位、因果图、需求层级等，并写旁挂 wiki。它是长任务（约 2–6 分钟），启动后不要同步等待：

```text
1. openstory_fact_books {root}                         → 确认 bookId
2. openstory_enrich_run {root,bookId,confirm:"create"}  → jobId
3. openstory_enrich_status {jobId}                     → 轮询
4. openstory_enrich_graph {root,bookId}                → 完成后读派生图谱
```

`factStale:true`、新写章节后关系未更新，都可以触发富化。但富化不是 fact 编辑接口，也不会替代 `openstory_fact_entries_import`。

## 与多角色扮演的区别

| 场景 | 使用工具 | 引擎与输入 | 确认 |
|---|---|---|---|
| 确定性开局/续拍 | `openstory_deduce_present` / `openstory_deduce_settle` | 种子化 2d6，局面卡与候选拍 | create |
| 推演会话节点推进 | `openstory_roleplay_turn` | 实际调用 `/api/deduce/turn`；选 `choiceId` 或给 `customText` | create |
| 多角色扮演开场 | `openstory_roleplay_opening` | 调用 `/api/roleplay/opening`，主持人＋演员，需要模型 | create |
| 多角色扮演一回合 | `openstory_roleplay_scene_turn` | 调用 `/api/roleplay/turn`，主持人裁决、角色成文与收束 | create |

`openstory_roleplay_turn` 虽然名字带 roleplay，仍是推演 turn；`openstory_roleplay_opening` 与 `openstory_roleplay_scene_turn` 才是独立的多角色扮演引擎。后两者无模型或空回包必须明确失败，不能伪造成功。它们的完整参数和会话写法见 [sessions.md](sessions.md)。
