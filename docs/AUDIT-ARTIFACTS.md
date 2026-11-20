# 产物 × 转换关系 静态盘点（OS-107）

生成于 2026-11-20T16:57:04.349Z

## 一、产物清单

| 产物 | 存储 | 读 | 写 | 判定 |
|---|---|---|---|---|
| 正文/章节 | `正文/NNN-标题.md` | ✓ | ✓ | daemon.writeChapterWithBackup（原子写＋.history 备份） |
| 拆解/事实条目 | `拆解/<bookId>.json（fact.data/v3）` | ✓ | ✓ | 内核 writeFactFile（revision + operationId 幂等） |
| 拆解/wiki 派生 | `拆解/<bookId>.wiki.json` | 经 curve 读 | 随 factEntriesImport 一起落 | 派生档（可删可重建），写随 fact |
| 世界书/参考笔记 | `参考/**/*.md（frontmatter）` | ✓ | 经 /api/chapter PUT（复用正文通道） | referenceStore 扫描解析；写复用正文通道 |
| 世界书/拆解词条视图 | `（无独立存储，读 fact）` | ✓ | 只读 | referenceEntryDetailHtml（OS-103/105） |
| 关系图谱 | `（纯计算）` | ✓ | 只读 | buildReferenceGraph（notes＋entries＋tags） |
| 故事源/三形态 | `（纯计算：fact entries ＋ wiki 章纲）` | ✓ | 只读 | storySource.layoutStorySource（三形态一次算好） |
| 剧本 | `剧本/**.md` | 经 files/chapter | 经 /api/chapter PUT | scriptFact.mjs 互转（script↔fact） |
| 推演/扮演会话 | `推演/<bookId>/session.json（+sessions/）` | ✓ | ✓ | deduceSession（原子写＋.history；多局＋rollingSummary） |
| 扮演回合 | `（写入 deduce session.nodes）` | ✓ | appendNode → saveDeduceSession | roleplayEngine（主持人＋N 角色；deAiPass 过闸） |
| 界面状态 | `.pinax/ui-state.json` | ✓ | ✓ | 本地化（不用 localStorage） |
| 后台任务 | `（进程内 Map）` | ✓ | ✓ | jobCenter（重启即清，不留幽灵） |

## 二、转换关系矩阵

| 从 | 到 | 类型 | 实现 | 双向 |
|---|---|---|---|---|
| fact 条目 | 世界书词条视图 | 读派生 | `refEntriesGroupHtml + referenceEntryDetailHtml` | — |
| fact 条目 | 关系图谱节点 | 读派生 | `buildReferenceGraph（kind:entry）` | — |
| 参考笔记 | 关系图谱节点 | 读派生 | `buildReferenceGraph（kind:reference）` | — |
| 参考笔记 [[条目:id]] | 图谱边 | 读派生 | `addEdge(note, entry, link, 2)` | — |
| fact 条目 | 故事源三形态 | 读派生 | `layoutStorySource（entries+wiki）` | — |
| wiki 章纲 | 故事源/AI上下文 | 读派生 | `ssWikiOf(curve.chapters)` | — |
| 剧本 | fact 条目 | 转换 | `scriptToFact（OS-78，往返验证过）` | ✓ |
| fact 条目 | 剧本 | 转换 | `factToScript（OS-78，往返验证过）` | ✓ |
| fact 条目 | 扮演底座 | 读派生 | `loadEntries + chapterLimit 过滤` | — |
| 参考笔记 firstChapter | agent 上下文过滤 | 读派生 | `notesVisibleAt(maxChapter)` | — |
| 扮演回合 | 会话节点 | 写入 | `appendNode(draft + beats)` | — |
| 会话节点 | 正文章节 | 转正 | `deducePromote（createChapter + backup）` | — |
| 会话/节点 | Markdown 导出 | 导出 | `deduceExport` | — |
| 故事源文本 | fact 条目 | **缺失** | `（未实现）` | — |
| 世界书笔记 | 故事源大纲 | **缺失** | `（未实现）` | — |
| fact 条目 | 参考笔记 | **缺失** | `（未实现，只能手动新建）` | — |

## 三、一致性与封装检查

- ✓ **firstChapter 在三处消费（世界书筛选/agent上下文/扮演底座）** — referenceStore 解析 → daemon notesVisibleAt 过滤 → roleplay present chapterLimit
- ✓ **referenceStore 双份（根/public）同口径** — 根目录版 daemon 用；public 版前端用——改一个必须同步另一个
- ✓ **文本类写入统一走 writeChapterWithBackup（原子写+备份）** — 正文/参考笔记/转正/剧本导入共用
- ✓ **fact 写入走内核 writeFactFile（revision+幂等）** — 回填/导入/剧本互转共用
- ✓ **会话写入走 saveDeduceSession（原子写+备份）** — 推演/扮演共用容器
- ✓ **故事源默认形态明确（outline）** — ss.view 默认 outline；三形态数据同一次算好
- ✓ **世界书两来源（笔记/词条）都有列表+详情+图谱** — 笔记：refNav/referenceEditorHtml/mountDetailGraph；词条：refEntriesGroupHtml/referenceEntryDetailHtml/mountEntryGraph
- ✓ **笔记↔词条切换时互斥状态清理** — openReference 清 activeEntry；词条点击清 activePath（OS-106 修）

## 四、结论
- 检查项：8/8 通过
- 缺失转换：3 条（故事源文本→fact 条目、世界书笔记→故事源大纲、fact 条目→参考笔记）
- 双向转换：2 条（剧本↔fact 是唯一双向）