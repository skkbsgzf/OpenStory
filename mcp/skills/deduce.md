# 推演模块（openstory_deduce_* / openstory_enrich_* / openstory_fact_curve）

推演是「如果世界」引擎：基于库的拆解事实（fact），种子化掷 2d6 推进剧情拍循环——**同样的种子同样的操作，结果完全可复现**。LLM 不在必然环节里，只在「戏剧候选」的可选来源里。

## 工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `openstory_deduce_present` | 开局/续拍：局面卡＋候选拍包 | 想知道「接下来会发生什么」 |
| `openstory_deduce_settle` | 结算一拍（选候选/veto） | 导演拍板 |
| `openstory_enrich_run` | 语义富化全量重算（**长任务**） | 正文/拆解变了之后 |
| `openstory_enrich_status` | 查富化进度 | 启动富化后轮询 |
| `openstory_enrich_graph` | 读知识图谱 | 分析人物关系/因果链 |
| `openstory_fact_curve` | 章级剧情曲线 | 分析全书节奏起伏 |

## 拍循环（present → settle）

```
openstory_deduce_present {root, bookId?}
  → { round, sceneCard（局面：张力/在场/时刻）, candidates[]（候选拍包） }

# 从 candidates 里挑一个（或 veto 否决），结算：
openstory_deduce_settle {root, candidateId, action: 'choose'}
  → { action, round }

# 再 present 出下一拍……循环推进
```

- `seed` 参数可复现：同一 seed 同一操作序列 = 同样的局面。做「如果世界」对比时，固定 seed 换候选即可分岔。
- `reset: true` 重置推演状态（从第一拍重来）。
- 结算产出的条目**只交回调用方，不自动写库**——要落库走 enrich 或参考写（对齐「推演不直接动稿」）。
- `WORLD_EMPTY` 错误＝这个 book 还没有世界书事实，先跑 enrich。

## enrich（语义富化）

`openstory_enrich_run` 做全量重算：六槽位（动机/台账/关系…）＋因果图＋需求层级，写旁挂 wiki。**12–35 次模型调用、2–6 分钟**：

```
1. openstory_enrich_run {root, bookId}     → { jobId }
2. openstory_enrich_status {jobId}         → 轮询（每 15–30s 一次）
3. openstory_enrich_graph {root, bookId}   → 完成后读知识图谱
```

注意：enrich 的 LLM 走**活动的运行时**——endpoint / CLI / DSH 三种都支持（OS-58 起统一走「单发单收」子 agent 模式，CLI 型会 spawn 一次性子进程）；输出被强制约束为纯 JSON，引擎侧有围栏/前后文容错。

## 什么时候跑 enrich

- `openstory_novel_write_chapter` 响应里 `factStale: true`（正文比事实新）
- 新写了好几章、拆解没跟上
- 知识图谱里查不到刚发生的人物关系

## 两个事实源的分工

- **fact（拆解）**：章级语义（每章的事件/情绪/功能），`openstory_fact_curve` 读
- **wiki（富化）**：跨章实体图谱（人物关系/因果/台账），`openstory_enrich_graph` 读

分析「第几章发生了什么」用 fact；「谁和谁什么关系、为什么」用 wiki。
