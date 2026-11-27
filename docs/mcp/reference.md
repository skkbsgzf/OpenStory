# 参考模块（openstory_reference_*）

参考是 Obsidian 式的标签双链笔记系统，但它**不是笔记软件的复刻**——在 OpenStory 的架构里它是「插件」，与小说插件隔离：只共享文件访问，**单向链接**小说。

## 工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `openstory_reference_index` | 全部笔记＋标签＋统计 | 找参考第一步；看标签描述 |
| `openstory_reference_graph` | 关系图谱（节点+带权边） | 理解关联结构，别逐个读文件 |
| `openstory_reference_read_note` | 单篇全文＋双段反链 | 写作取材 |
| `openstory_reference_write_note` | 写/建一篇参考 | 记设定、人物卡、伏笔账 |

## 三个概念

**标签（tag）**：`#人物`、`#人物/梁山`（`/` 是层级）。Obsidian 口径的 tokenizer：行首或空白后的 `#词` 才算；纯数字拒绝。标签可以有**描述**（`世界书/标签/人物.md` 里 frontmatter `kind: tag` + `description`）——`reference_index` 返回的 tags 里带 description。

**双链（wikilink）**：`[[标题]]` / `[[标题|显示文本]]` / `[[正文/001-xxx.md|别名]]`。解析前会掩掉代码块。图谱边权：link（双链）=2、mention（提及未建链）=min(n,3)、tag=1。

**单向原则（红线）**：边只从**参考出发**指向产物。参考笔记可以写 `[[正文/001-xxx.md|第一回]]`；**正文里不要写 `[[某参考]]` 回挂**——那会污染正文的纯净性，也让参考的上下文反向渗进正文。`openstory_reference_write_note` 只接受以 `世界书/` 开头的 file（世界书是当前正名），不以该前缀开头的路径在调用 daemon 前即被拒绝；旧 `参考/` 目录名已退役。

## 写一篇参考的规范

```md
---
tags: [人物, 梁山]
title: 宋江
---

# 宋江

绰号「呼保义」，又号「及时雨」……（正文）

关联：[[李逵]]、[[浔阳楼]]、[[招安之争]]
```

- frontmatter `tags` 数组是主入口（行内 `#标签` 也认，但 frontmatter 是权威）。
- 内部互链用 `[[标题]]`；链接正文用全路径 + 别名 `[[正文/001-xxx.md|第一回]]`。
- **不要**在正文区写「本回关联：[[某参考]]」——方向反了。
- 写入会先备份原稿进 `.history`（响应 `backup` 字段）。
- **OS-211 起写通道是专用端点** `PUT /api/reference/note`（请求 `{ root, path, text }`）：
  端点归属世界书模块（停用回 `409 MODULE_DISABLED`），只放行 `世界书/` 下的路径。
  通用章节端点 `PUT /api/chapter` 已收窄到载体目录（正文／剧本），**不再**接受世界书写入；
  真源仍是同一份 `writeChapterWithBackup`（原子写＋`.history`＋变更日志）。

## 反链的两段口径

`openstory_reference_read_note` 返回 `backlinks`：
- `linked`：谁用 `[[...]]` 链接了这篇（结构边）
- `unlinked`：谁的正文**提到了**这篇的名字但没建链（Obsidian 的 unlinked mentions）——这是「该建链没建」的线索

## 典型任务流

**给新章查材料**
```
1. openstory_reference_index            → 看标签树找相关笔记
2. openstory_reference_graph            → 或从图谱看这章关联哪些参考
3. openstory_reference_read_note ×n     → 取人物卡/纪律/伏笔
```

**沉淀新设定**
```
1. openstory_reference_index            → 确认没有重复笔记
2. openstory_reference_write_note       → 世界书/人物/新角色.md（frontmatter tags；file 必须以 世界书/ 开头）
3. openstory_reference_graph            → 确认新节点与边挂上了
```
