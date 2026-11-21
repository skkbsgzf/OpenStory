# 同源同步盘点（OS-113）

生成于 2026-11-21T10:48:19.120Z

## 一、同源关系清单

| # | 上游 | 下游 | 版本字段 | 有检测 |
|---|---|---|---|---|
| 1 | 拆解/<bookId>.json（revision 自增） | 拆解/<bookId>.wiki.json（章摘要/人物档/伏笔） | wiki.derivedFrom.factRevision | ✗ |
| 2 | 拆解/<bookId>.json | 故事源三形态（大纲/表格/图表） | entry.revision（文件级，逐条目透出） | ✗ |
| 3 | 拆解/<bookId>.json | 世界书·拆解词条分区 | entry.revision | ✗ |
| 4 | 拆解/*.json + 参考/**/*.md | 关系图谱（节点/边） | 无 | ✗ |
| 5 | 参考/**/*.md（mtime） | 世界书列表/标签树/反链 | note.mtime（逐篇） | 部分 |
| 6 | 剧本/*.md | 拆解条目（scriptToFact / factToScript） | 无 | ✗ |
| 7 | 拆解/<bookId>.json | 扮演 present/roleplayTurn 的事实包 | 无 | ✗ |
| 8 | 正文/**.md（mtime） | 拆解条目（provenance.chapters/sources） | 无 | ✗ |
| 9 | 正文/**.md | systemPromptFor 的参考资料索引（按最大章号过滤） | currentChapter 实时算 | 实时 |
| 10 | 界面操作 | .pinax/ui-state.json | 无（整份覆盖） | 不需要 |

## 二、逐条说明

### fact→wiki
- 上游：拆解/<bookId>.json（revision 自增）
- 下游：拆解/<bookId>.wiki.json（章摘要/人物档/伏笔）
- 版本字段：wiki.derivedFrom.factRevision
- 说明：内核 readFactWiki 会返回 derivedFrom，但 OpenStory 没有任何地方拿它和当前 revision 比。实测泄密的心：wiki 记 factRevision=1，fact 已 revision=4——已过期 3 版，界面无感知。

### fact→故事源
- 上游：拆解/<bookId>.json
- 下游：故事源三形态（大纲/表格/图表）
- 版本字段：entry.revision（文件级，逐条目透出）
- 说明：故事源顶部显示「《泄密的心》· revision 4」（看见版本号），但没有「你看到的这份是否比磁盘旧」的判断——纯展示。

### fact→世界书词条
- 上游：拆解/<bookId>.json
- 下游：世界书·拆解词条分区
- 版本字段：entry.revision
- 说明：词条列表不带 revision，也不刷新感知。

### fact+notes→图谱
- 上游：拆解/*.json + 参考/**/*.md
- 下游：关系图谱（节点/边）
- 版本字段：无
- 说明：state.refCol.graph 一旦加载就缓存（loadRefGraph 有 force 参数但没人自动调）。参考笔记改了图谱不会自动重算。

### 参考笔记→世界书索引
- 上游：参考/**/*.md（mtime）
- 下游：世界书列表/标签树/反链
- 版本字段：note.mtime（逐篇）
- 说明：只有编辑块后 1.6 秒防抖重扫（commitRefBlock 里 refRescanTimer）。外部改动（VSCode 改文件）不感知。

### 剧本↔fact
- 上游：剧本/*.md
- 下游：拆解条目（scriptToFact / factToScript）
- 版本字段：无
- 说明：互转是一次性动作，两边都不记「从哪一版转来的」。转完任一边改了，另一边不知道。

### fact→扮演底座
- 上游：拆解/<bookId>.json
- 下游：扮演 present/roleplayTurn 的事实包
- 版本字段：无
- 说明：每回合现读（loadEntries），天然拿最新——这里反而是对的，不需要版本检测。

### 正文↔拆解
- 上游：正文/**.md（mtime）
- 下游：拆解条目（provenance.chapters/sources）
- 版本字段：无
- 说明：正文改了，拆解里引用的段号/内容不会自动失效——这是最大的缺口。

### 正文→agent上下文
- 上游：正文/**.md
- 下游：systemPromptFor 的参考资料索引（按最大章号过滤）
- 版本字段：currentChapter 实时算
- 说明：每次组 prompt 现算，天然最新。

### UI状态
- 上游：界面操作
- 下游：.pinax/ui-state.json
- 版本字段：无（整份覆盖）
- 说明：偏好类，不需要版本。

## 三、结论

**有版本字段的**：fact 文件 revision（内核自增）、wiki derivedFrom.factRevision、参考笔记 mtime、条目 entry.revision。

**真正做了失效检测的**：只有 2 处——① commitRefBlock 编辑后 1.6s 防抖重扫参考索引（仅自己写的）；② agent 上下文每次现算 currentChapter（天然最新）。

**完全没检测的（主要缺口）**：
1. **wiki 派生档过期**——fact revision 涨了，wiki 还标着老 factRevision，界面照用（实测已过期 3 版）
2. **正文改了拆解不知道**——拆解条目的 provenance 引用段号/原文，正文改动后没有任何失效标记
3. **外部编辑参考笔记不感知**——只有本页编辑才重扫，VSCode 改文件要手动刷新
4. **剧本↔fact 互转无溯源**——转完不知道转自哪一版
5. **图谱不自动重算**——参考笔记/拆解变了，state.refCol.graph 还是旧的

**天然正确的（不需改）**：扮演底座每回合现读、agent 上下文实时算章号。