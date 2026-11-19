# 模块定位重划（OS-73 起）

> 作者裁定（2026-11-19）：世界书只管条目，故事源只管剧情。本文档固化这条分界与各自的验收口径。

## 三块的分工

| 模块 | 只负责 | 明确不负责 | 现状 |
|---|---|---|---|
| **世界书** | 人/事/物**条目管理**；对作品的**合理性、一致性**负责 | 剧情走向、大纲、爽不爽 | 基本达标 |
| **故事源**（原「拆解」） | **剧情管理**；只管精彩不精彩 | 一件事合不合理（那是世界书的事） | 重建中 |
| **推演** | 「如果世界」模拟，产拍与候选 | 沉淀事实（回填待确认卡） | 已完成 |

**关键分界**：故事源不管合理性。它读 fact 链、呈现剧情结构、算精彩度；合理性归世界书（条目之间有矛盾就是世界书的问题）。

## 世界书：还差的两件

### 1. 参考图 / 设定图（规格补充）

**现状缺口**：`referenceStore.mjs` 解析 frontmatter 存了整个 `data` 对象，但**没有任何字段被消费**；`md.mjs` 支持 `![]()` 但 frontmatter 里写 `cover:`/`ref_images:` 无人读；素材目录只服务推演舞台，与世界书不通。

**目标形态**：
- 人物单页 = **简历 / 角色档案**风格：肖像 + 基本信息表 + 特质标签 + 关系图 + 关键台词 + 代表场景
- 场景 / 道具支持**基于参考信息一键生图**（可反复调整）

**落地方案**：
1. frontmatter 新字段：`cover: assets/portrait.png`、`ref_images: [a.png, b.png]`
2. `referenceStore` 索引带 `images[]`
3. 详情页顶部图墙 + 「生成设定图」按钮
4. 生图产物落 `参考/<条目目录>/assets/<name>.png`，回填 frontmatter

### 2. 看图写作 Skill（新包，30→31）

**缺口**：`skills/` 30 个包**零个**图像相关；MCP 20 工具无识图。

**要做的包 `visual-describe`**：
- 输入：图片路径 + 目标（角色外形 / 场景氛围 / 巨型怪物）
- 用 vision 接口读图，输出**文学化白描**（不是技术描述）
- 产文写进世界书条目
- 配套 MCP 工具：`openstory_vision_describe`（图→文）、`openstory_image_generate`（文→图）

**为什么早做**：作者原话「后续对生图和视频都有帮助」——白描质量直接决定生图 prompt 质量。

## 故事源：三形态

**定位**：本质是 Fact 链的可视化，扮演小说大纲功能。

### 形态 1：大纲形态（文档式）
传统文档编辑，参考专业剧情大纲文本格式，**基于 Fact 链双向实现**：
- 改文本 → 生成 fact patch
- 改 fact → 重渲染文本

### 形态 2：数据形态（多维表单）
参考飞书多维表格：
- 表格视图（行=条目，列=字段）
- 看板视图（按 status/layer 分组）
- 工作台视图
- 可转**多轨并行图**（反馈角色协同行为：横轴时间，纵轴角色/势力轨道，色块=事件，连线=因果）

### 形态 3：分析形态（图表）
结合编剧技能知识：
- 剧情曲线（张力/情绪/密度）
- 伏笔回收（埋/收/悬）
- 剧情密度热力图
- **ECharts**（作者裁定走 CDN / 本地 vendor 单文件）

## 双层对齐问题（实测发现）

Qbook 短篇《脱轨》实测：
- **fact 侧**：291 条目，`provenance.segmentIndex` 1–267（正文段号），`provenance.chapters` 全部标 `[1]`
- **wiki 侧**：38 章摘要，有 title/function/emotion/beats

**两套编号不是一回事**。所以故事源的章树必须：
1. 优先用 `provenance.chapters[0]`
2. 缺失时按 `segmentIndex` 均分兜底
3. 在返回里标 `alignment: 'exact' | 'approximate'`

这是 P1 的硬前置——真实实现需要 enrich 产出章↔段的对齐表。

## 接口严谨性要求（作者点名）

世界书和故事源的接口需要「增量更新、diff 更新、同步更新、缓存、分支」：

| 规格 | 现状 | 设计 |
|---|---|---|
| 原子写 + revision 自增 | ✅ 内核 `writeFactFile` | 已就绪 |
| operationId 幂等 | ✅ 内核 `.operations.jsonl` | 已就绪 |
| 乐观并发闸 | ✅ `expectedRevision` → `REVISION_MISMATCH` | 已就绪 |
| **fact 写端点** | ❌ **62 端点里零个** | S1 只做读；写端点下一期 |
| **增量更新（PATCH）** | ❌ | JSON-Patch 风格 ops + `If-Match: revision` |
| **diff 查询** | ❌ | `?since=<revision>` 返回变更集 |
| **分支** | ⚠️ 只在推演会话（`branchId`），fact 层零分支 | `拆解/.branches/<branchId>/<bookId>.json` 写时复制 |
| **缓存** | ❌ | 内存 LRU 按 `(root, bookId, revision)` |

## 设置：要配齐的能力

作者点名：
- 全局**生图**接口（含可行性校验）
- 全局**识图**接口（含可行性校验）
- DSH **model 选项**：默认模型、默认子 agent 模型
- 其他常用 agent 设置

**现状**：`agent-config.json` 只有单套 `{endpoint,model,apiKey,runtime,reasoningEffort,chineseReasoning}`；生图从里边顺带读 `imageEndpoint`；识图完全不存在。

**目标**：配置拆 `text` / `image` / `vision` 三块 + `agent` 默认档；
`POST /api/config/probe` 做真连通性校验（各发一个最小请求）。

## 分析能力封装化

作者要求：**分析能力封装化，做在故事源里实现后可以在正文里选装、跳转。**

- 现状：`analysis.mjs` 两个导出（`splitSentences`/`analyzeChapter`）；正文页右栏是写死的卡片集
- 目标：`public/analysisModules.mjs` 注册表（`scope: 'chapter' | 'work'`），故事源承载 work 级，正文页可勾选启用 + 跳转
- **硬约束**：`analyzeChapter` 行为不许变（MCP `openstory_analysis_chapter` 依赖它）
