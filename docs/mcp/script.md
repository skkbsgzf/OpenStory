# 剧本与 fact 互转域

剧本互转是纯结构映射与渲染：不写盘、不调模型，也不代替 fact schema 校验或章节写入。两个方向都先产数据给调用方检查，再由对应写工具落库。

## 工具

| 工具 | 必填参数 | 用途与返回 | 最低确认 |
|---|---|---|---|
| `openstory_script_to_fact` | `root,text` | 完整剧本 → fact 条目骨架（幕/角色/场景）；`bookId/domain` 可选 | read |
| `openstory_script_from_fact` | `root` | fact 条目 → 剧本文本；`bookId/entries/wiki` 可选 | read |

## 剧本转 fact 骨架

```text
1. openstory_script_to_fact {root,text:"完整剧本文本",bookId?,domain?}
   → entries / wiki / stats
2. 检查并补全为合法 fact 条目
3. openstory_fact_books {root}
4. openstory_fact_entries {root,bookId}
5. openstory_fact_entries_import {root,bookId,entries:[...],operationId:"...",confirm:"create"}
6. openstory_fact_entries {root,bookId} → 回读
```

`openstory_script_to_fact` 只做结构映射，不执行 schema/revision/备份，也不会自动建事实书或写主档。返回的 `entries` 是骨架，不能未经检查直接当作完整事实书。

## fact 转剧本

```text
openstory_script_from_fact {root,bookId}
  → text / stats

openstory_script_from_fact {root,entries:[...],wiki:{...}}
  → 使用显式条目渲染，不先读现档
```

省略 `bookId` 与 `entries` 时不会凭空生成剧本；空条目会明确报错，不以空文本冒充成功。渲染结果不会自动写入正文/剧本目录；需要落盘时先按 [novel.md](novel.md) 读取或新建目标章节，再 `openstory_novel_write_chapter` 完整覆盖，并用 `openstory_chapters_rename` 调整标题。

## 边界

- 互转工具本身是 read 级，`confirm` 可省略。
- fact 主档写入只走 [fact.md](fact.md) 的合法链；enrich 不替代这一步。
- 剧本载体文件写入只走章节写工具；世界书内容走 `openstory_reference_write_note`。
