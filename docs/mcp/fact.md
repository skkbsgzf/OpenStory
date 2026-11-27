# 故事源事实域

故事源 fact 是结构化事实主档：事实书用 `bookId` 定位，条目有 schema、层级与 revision。正文、世界书、推演和 enrich 都消费事实，但都不能替代合法 fact 写入。

## 工具

| 工具 | 必填参数 | 用途与返回 | 最低确认 |
|---|---|---|---|
| `openstory_fact_books` | `root` | 列事实书的 `bookId`、标题、条目数与 revision | read |
| `openstory_fact_entries` | `root` | 读条目；`bookId/layer/q/offset/limit` 可选，返回 revision、total、entries、layers | read |
| `openstory_fact_entries_import` | `root,bookId,entries` | 用完整条目数组整份替换事实书；`title/wiki/operationId` 可选 | create |

## 合法写入链

```text
1. openstory_fact_books {root}
   → 选真实 bookId，记录 revision

2. openstory_fact_entries {root,bookId,layer?,q?,offset?,limit?}
   → 读旧条目与 revision；需要保留未修改条目时一并纳入新数组

3. openstory_fact_entries_import {
     root, bookId, entries:[...完整新条目...],
     operationId:"本次操作的稳定幂等键",
     confirm:"create"
   }

4. openstory_fact_entries {root,bookId}
   → 回读条目与 revision，确认整份结果
```

**这是整份替换，不是合并。** 调用后 `entries` 就是该事实书的全部条目；只传一条不会只更新那一条，遗漏的旧条目会消失。逐条修改应先完整读取，构造全量结果，再整份导入。

## schema、revision 与幂等

- 每条 `entries` 元素都必须满足 fact schema。任一条不合法，整份拒绝、零写入。
- 写入前备份主档，成功后推进 revision，并记录日志。调用方应保存 `operationId`；同 id 重放不重复写。
- `operationId` 在 inputSchema 中可选，但生产写入应提供稳定且唯一的幂等键，便于网络重试与失败恢复。不要为不同内容复用同一 key。
- `title` 可选，用于事实书标题；`wiki` 是可选派生结构，`derivedFrom` 由写入端按写后 revision 确定。
- 回读时核对 revision、条目总数与关键内容。若写入失败，先读 `openstory_fact_entries` 判断是否已落盘，再决定是否用同一 `operationId` 重放。

## enrich 不是 fact 写工具

`openstory_enrich_run` 从现有事实做语义富化，写旁挂 wiki（实体关系、因果、需求层级等）；它不会把推演候选、正文新事件或剧本骨架自动写入 fact 主档。需要新增或修正事实时，仍必须走上述 `openstory_fact_entries_import` 流程。

## 剧本与外部格式

- `openstory_script_to_fact` 只把剧本文本映射成 fact 条目骨架，不写盘。先检查骨架，再纳入完整数组交给 `openstory_fact_entries_import`。
- `openstory_exchange_import` 是另一条受支持的外部格式入口，先 `dryRun:true` 预览，再真写；它的写入同样走 fact 写协议。格式与边界见 [exchange.md](exchange.md)。
