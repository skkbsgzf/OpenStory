# 小说与章节域

小说章节落在 `正文/NNN-标题.md`，剧本载体按库的章节契约使用同类 `NNN-标题.md` 文件；NNN 是三位编号。写作规矩来自习惯表，事实依据来自故事源，候选剧情可来自推演，但章节工具本身只负责载体文件的读取、写入与命名。

## 工具

| 工具 | 必填参数 | 用途与边界 | 最低确认 |
|---|---|---|---|
| `openstory_novel_list_chapters` | `root` | 列默认正文目录的编号、标题、字数；写前先定位章号 | read |
| `openstory_novel_read_chapter` | `root,file` | 读完整 md 源文；`file` 是库内相对路径 | read |
| `openstory_novel_write_chapter` | `root,file,text` | 整章覆盖，不是增量 patch；备份原稿并返回 `factStale` 与习惯命中 | create |
| `openstory_novel_new_chapter` | `root` | 取最大编号加一、三位补零新建空章；`title` 可省略，缺省标题来自写作套件 | create |
| `openstory_novel_delete_chapter` | `root,file` | 把原稿挪入 `.history`，不是真删；返回备份路径 | restore |
| `openstory_chapters_rename` | `root,file,title` | 只换标题段、保留编号；目标冲突拒绝，只允许正文/剧本载体路径 | create |

## 写入语义

- `openstory_novel_write_chapter` 接收完整章节 `text`。先 `openstory_novel_read_chapter` 确认目标，再把完整结果传回；它不是补丁接口。
- 覆盖写会备份原稿，响应中的 `backup` 是人工恢复线索。`openstory_novel_delete_chapter` 同样是备份式删除。
- 文件名使用 `NNN-标题.md`。新章用 `openstory_novel_new_chapter` 取号，不猜编号；重命名用 `openstory_chapters_rename`，不在写正文时偷偷改文件名。
- 章节写工具只落正文/剧本载体目录。写 `故事源/` 会被拒；写 `世界书/` 使用 `openstory_reference_write_note`。
- `factStale: true` 表示正文比故事源事实新。它**不表示 enrich 会自动补 fact 主档**：合法 fact 变更走 `openstory_fact_books` → `openstory_fact_entries` → `openstory_fact_entries_import`；需要重建跨章实体、因果等派生 wiki 时再运行 `openstory_enrich_run`。

## 典型任务流

**续写下一章**

```text
1. openstory_habits_read {root}                      → 作者写作规矩
2. openstory_novel_list_chapters {root}               → 当前最后一章
3. openstory_fact_books {root}                       → 定位事实书
4. openstory_reference_index {root}                  → 找人物、纪律、伏笔
5. openstory_novel_read_chapter {root,file}           → 读上一章
6. openstory_fact_entries {root,bookId}              → 核对事实依据
7. openstory_novel_new_chapter {root}                → 取新章路径
8. openstory_novel_write_chapter {root,file,text,confirm:"create"} → 完整落盘
```

**改写一章**

```text
1. openstory_novel_read_chapter {root,file}
2. openstory_analysis_chapter {text:"原文"}           → 文风与 AI 味基线
3. 按习惯表改写
4. openstory_novel_write_chapter {root,file,text,confirm:"create"}
5. openstory_analysis_chapter {text:"改写稿"}         → 对照指标
```

**仅调整标题**

```text
openstory_chapters_rename {root,file,title:"新标题",confirm:"create"}
```

标题不含 `NNN-` 前缀。若库有回目式标题纪律，应先读世界书中的纪律笔记，再决定 `title` 内容。
