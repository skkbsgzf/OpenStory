# OpenStory 本地 MCP · 总览（对外分发材料）

OpenStory 是跑在本机的小说工作台：**小说**（正文读写＋事实链）、**参考**（Obsidian 式标签双链笔记，定位＝本项目的创作型条目管理知识库）、**推演**（种子化拍循环＋语义富化）、**数据分析**（本地引擎）四个模块。这份材料给拿到 MCP 连接的外部 agent：每个模块的能力边界、工具清单、什么时候用什么、红线在哪。

## 连接

```json
{ "command": "node", "args": ["D:\\OpenStory\\src\\host\\mcp.mjs"] }
```

- 前置：OpenStory daemon 必须在本机跑着（`npm start`，默认 `127.0.0.1:8807`；用环境变量 `OPENSTORY_PORT` 改端口）。
- 唯一例外：`openstory_analysis_chapter` 是纯本地计算，不依赖 daemon。
- stdio 协议：newline-delimited JSON-RPC 2.0；`initialize → tools/list → tools/call`。

## 四个模块的分工

| 模块 | 工具前缀 | 一句话 | 详细说明 |
|---|---|---|---|
| 元 | `openstory_libraries` / `openstory_files` | 拿 root、看目录 | 见下 |
| 小说 | `openstory_novel_*` | 正文的读与写（写有备份） | [novel.md](novel.md) |
| 习惯 | `openstory_habits_read` / `openstory_habits_put` | 作者写作习惯表（成文前必读必守） | 见下 |
| 参考 | `openstory_reference_*` | Obsidian 式标签双链笔记 | [reference.md](reference.md) |
| 推演 | `openstory_deduce_*` / `openstory_enrich_*` / `openstory_fact_curve` | 种子化拍循环＋语义富化 | [deduce.md](deduce.md) |
| 分析 | `openstory_analysis_chapter` | 本地秒回的文本分析 | [analysis.md](analysis.md) |

**习惯表**：`openstory_habits_read` 读本库作者的文风自述、禁用词/惯用词/禁用句式等规矩——**任何写正文/参考的动作前必读，产出必须逐条遵循**。`openstory_habits_put` 只在作者明确要求调整习惯表时使用（整表覆盖，写有备份）。正文写入工具会自动做习惯命中检查并在返回里给 `habitHits`——命中了先改产出，别删规矩。

## 标准开场

```
1. openstory_libraries          → 拿 root（库的绝对路径）
2. openstory_files {root}       → 看目录结构
3. 按任务进对应模块（工具说明见各 skill 文件）
```

所有工具的第一个参数都是 `root`——库的绝对路径，来自 `openstory_libraries`。

## 红线（全部工具通用）

1. **写＝有备份，不是无痕**：正文/参考的写入会先把原稿挪进 `.history/`（返回 `backup` 路径，可人工找回）；删除同理（挪进 `.history`，不是真删）。写前先 read 确认目标。
2. **absorb 不开 MCP**：旧目录迁入参考是显式动稿操作，只在 OpenStory 界面里由作者点按钮，绝不自动调用。
3. **参考单向链小说**：参考笔记可以 `[[正文/001-xxx.md|别名]]` 链接正文；**正文不要回挂参考**——正文是纯净写作面，参考的单向链接保证它不污染正文上下文。
4. **Agent 对话/待确认卡不在 MCP 里**：OpenStory 自己的 Agent 有人在环确认（待确认卡），MCP 外部 agent 的写入没有这层——你自己就是确认环节，写前自查。
5. **enrich 是长任务**（2–6 分钟）：启动后拿 jobId 轮询 `openstory_enrich_status`，不要同步等待。

## 协议约定

- 业务错误：`result.isError: true`，文本以 `ERR_*` code 开头（如 `NO_LIBRARY · root 不在库清单里`）——**这不是协议失败，是业务回话**，读文本理解原因。
- 参数缺失：JSON-RPC `-32602`（`缺少必填参数：root`）。
- 未知工具/方法：`-32601`。
