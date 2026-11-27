# 世界书域

世界书是 OpenStory 的创作型条目知识库：Obsidian 式标签、双链与反链，装人物、地点、设定、写作纪律和伏笔。它与小说正文共享库文件访问，但保持单向关系：世界书可链正文，正文不回挂世界书。世界书不是事实主档，写事实必须走 fact 域。

## 工具

| 工具 | 必填参数 | 用途与返回 | 最低确认 |
|---|---|---|---|
| `openstory_reference_index` | `root` | 返回世界书 `notes`、`tags`、`stats`；找条目先看索引 | read |
| `openstory_reference_graph` | `root` | 返回节点、带权边与统计；理解关联结构，不逐文件猜 | read |
| `openstory_reference_read_note` | `root,path` | 读 `世界书/` 下完整笔记，并返回 `linked` / `unlinked` 两段反链 | read |
| `openstory_reference_write_note` | `root,file,text` | 整篇写入或新建 `世界书/` 笔记；备份原稿并回显习惯命中 | create |

`file` 与 `path` 都是库内相对路径，例如 `世界书/人物/沈小楼.md`。工具只接受世界书目录，不提供任意路径写通道。

## 标签、双链与反链

- **标签**：frontmatter 的 `tags` 数组是权威；行内 `#标签` 也会识别，`/` 表示层级，纯数字标签拒绝。标签笔记可用 `kind: tag` 与 `description` 提供说明。
- **双链**：内部条目用 `[[标题]]` 或 `[[标题|显示文本]]`；链正文用完整相对路径，如 `[[正文/001-第一回.md|第一回]]`。解析会掩掉代码块。
- **图谱边权**：双链 `link` 为 2，未建链提及 `mention` 最多为 3，标签 `tag` 为 1。
- **反链**：`linked` 是已建双链的来源；`unlinked` 是提到标题但未建链的来源。前者是结构关系，后者是待整理线索。

## 世界书专用写端点

`openstory_reference_write_note` 走世界书模块独占的 `PUT /api/reference/note`，请求为 `{ root, path, text }`：

- 只放行 `世界书/` 下的路径；模块停用返回 `409 MODULE_DISABLED`。
- 通用 `PUT /api/chapter` 已收窄到正文/剧本载体目录，不再接受世界书写入。
- 底层仍共用原子写、`.history` 备份与变更日志；MCP 薄适配不另造写协议。

## 笔记格式

```md
---
tags: [人物, 梁山]
title: 宋江
---

# 宋江

绰号「呼保义」，又号「及时雨」……

关联：[[李逵]]、[[浔阳楼]]、[[招安之争]]
```

- 内部互链用 `[[标题]]`；链正文用 `[[正文/001-第一回.md|第一回]]`。
- 不在正文里回写 `[[世界书/...]]`。世界书链正文不等于正文反向引用世界书。
- 写入前先 `openstory_reference_index` 查重，再 `openstory_habits_read` 读规矩；已有笔记先 `openstory_reference_read_note` 读旧稿。
- 写后回读，并用 `openstory_reference_graph` 确认节点与边。响应可能包含 `habitHits`，命中后应修改产出，而不是删作者规矩。

## 典型任务流

**给新章查材料**

```text
openstory_reference_index {root}
  → openstory_reference_graph {root}（需要看关联时）
  → openstory_reference_read_note {root,path}（逐篇取材）
```

**沉淀新设定**

```text
1. openstory_reference_index {root}
2. openstory_reference_read_note {root,path}（已有笔记先读）
3. openstory_reference_write_note {root,file,text,confirm:"create"}
4. openstory_reference_read_note {root,path}（回读）
5. openstory_reference_graph {root}（核对关联）
```
