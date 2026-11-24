# 小说模块（openstory_novel_*）

小说是 OpenStory 最重的模块：章节是 `正文/NNN-标题.md` 文件（NNN 三位编号自动解析），写作纪律、拆解事实、推演都以它为锚。

## 工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `openstory_novel_list_chapters` | 章节清单（编号/标题/字数） | 任何任务第一步：定位章号 |
| `openstory_novel_read_chapter` | 读一章完整 md 源文 | 写前必读；续写前读上一章 |
| `openstory_novel_write_chapter` | **整章覆盖**写入 | 改写/续写产出落盘 |
| `openstory_novel_new_chapter` | 自动编号新建空章 | 开新章 |
| `openstory_novel_delete_chapter` | 删除（进 .history） | 少用 |

## 写入语义（最重要的部分）

- `openstory_novel_write_chapter` 是**整章覆盖**，不是增量 patch。先 `read`，改完把完整章节丢回来。
- 写入前 daemon 自动把原稿备份进 `正文/.history/`（响应里 `backup` 字段是备份路径）。写错了可以人工从备份找回。
- 响应里 `factStale: true` 表示**正文比拆解事实新**——你刚写的章还没有事实条目支撑（剧情曲线、知识图谱都是旧的）。补救：跑 `openstory_enrich_run`（长任务）同步。
- 文件名格式必须是 `正文/NNN-标题.md`。新章编号用 `openstory_novel_new_chapter` 自动拿，不要自己猜号。

## 标题格式（水浒样本库示例）

回目式标题是库的**写作纪律**约束（在参考系统里），不是 MCP 的：`第一回　张天师祈禳瘟疫　洪太尉误走妖魔`。正文首行 H1 就是章名；工具层只管文件名 `NNN-标题.md`，标题内容去参考系统查纪律。

## 典型任务流

**续写下一章**
```
1. openstory_novel_list_chapters          → 知道写到第几章
2. openstory_reference_index              → 看有哪些参考（纪律/人物/大纲）
3. openstory_novel_read_chapter 上一章     → 接上文
4. openstory_reference_read_note 相关参考  → 人物设定/伏笔清单
5. 产出正文
6. openstory_novel_new_chapter            → 拿新章文件名
7. openstory_novel_write_chapter          → 落盘
```

**改写一章**
```
1. openstory_novel_read_chapter           → 原文
2. （可选）openstory_analysis_chapter     → AI 味/文风基线
3. 改写
4. openstory_novel_write_chapter          → 覆盖写（旧稿自动进 .history）
5. （可选）openstory_analysis_chapter     → 对比改写后的指标
```

## 和其它模块的勾连

- **参考**：写作纪律/人物卡/伏笔都在参考系统里，`openstory_reference_read_note` 取；图谱（`openstory_reference_graph`）告诉你这章和哪些参考有关。
- **推演**：不知道下一章写什么 → `openstory_deduce_present` 出局面与候选拍。
- **分析**：写完跑 `openstory_analysis_chapter` 自查 AI 味与节奏。
- **事实链**：写入后 `factStale=true` 就跑 enrich。
