# 导入导出域

导入导出连接故事源 fact 与外部 `pedia/v1` / `jsonl` 表示。它不是任意 Markdown、CSV 或文件搬运通道；支持格式以 daemon 契约为准。

## 工具

| 工具 | 必填参数 | 用途与返回 | 最低确认 |
|---|---|---|---|
| `openstory_exchange_export` | `root,bookId,format` | 投影事实条目为外部格式；缺省只返回数据，`save:true` 才落盘 | read；`save:true` 时 create |
| `openstory_exchange_import` | `root,bookId,format,text` | 解析外部文本并适配 fact；`dryRun:true` 只预览，缺省真写 | create（即使 dryRun） |

## 支持格式

- `pedia/v1`：导出为 JSON 数组；导入接受单个条目对象、`{ entries:[...] }` 包装或数组。
- `jsonl`：每行一个 JSON 条目；导出会带末尾换行。

`csv`、`markdown` 不是当前 exchange 契约支持格式。daemon 对未知格式返回 `INVALID_ENTRY`。

## 导出

```text
openstory_exchange_export {root,bookId,format:"jsonl"}
  → bookId / entries / lost

openstory_exchange_export {root,bookId,format:"jsonl",save:true,confirm:"create"}
  → 同上，并返回落盘 file
```

`entries` 是外部投影，不保证与 fact 主档逐字段同形；`lost` 明列目标格式装不下的字段。缺省 `save` 为 false，只回数据、不落盘。只有 `save:true` 触发条件写，必须提供 create 级确认；落盘位置在库的 `导入导出/` 目录。

## 导入

```text
1. openstory_exchange_import {
     root,bookId,format:"jsonl",text:"...",dryRun:true,confirm:"create"
   }
   → entries 数量 / errors / warnings / skipped

2. 修正解析或字段问题，确认预览结果

3. openstory_exchange_import {
     root,bookId,format:"jsonl",text:"...",dryRun:false,confirm:"create"
   }
   → written { bookId,revision,backup }

4. openstory_fact_entries {root,bookId}
   → 回读事实书
```

`dryRun:true` 保证零写入，但注册表仍把整个工具按写工具处理：**预览也必须带 `confirm:'create'`**。不能把“可能只预览”当成免确认理由。

真写会适配到 fact，再经与 `openstory_fact_entries_import` 相同的写入函数完成 schema 校验、原子写、revision、备份与日志。`skipped` 会列出被适配器跳过的条目（例如已解耦的 style 层）；`errors` 非零时不会继续真写。

## 整份替换边界

exchange 真导入会把适配后的完整条目集合交给 fact 写入函数，不是按外部 id 做增量 upsert。导入前先用 `openstory_fact_entries` 读取现档并核对目标 `bookId`，避免把预览集误当完整事实书。
