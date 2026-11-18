# 创作知识库（内部）——资产盘点与业务关联

> **定位（OS-57，作者口径）**：本目录＝**全局知识库**的仓内部分，系统内部级别，**暂不开源**。
> 它不给终端功能当数据用，而是给各功能的**提示词/判定规则**当源头——写提示词时尽可能参考这里。
> 另一大半在仓外的 Qbook（`D:/Qbook/短篇选题库/`：市场效率数据＋分析报告＋拆解 wiki）。

## 三层知识架构（作者裁定）

| 层 | 名称 | 归属 | 内容 | 存储 |
|---|---|---|---|---|
| 项目层 | **世界书**（原「参考」） | 每个库自己的创作型条目管理知识库 | 人物/场景/事件/大纲等条目，Obsidian 式标签双链 | 库内 `参考/` 目录 |
| 项目层 | **习惯** | 每个库自己的写作习惯表 | 文风自述、禁用词、惯用词、禁用句式、禁用修辞、描述公式（正向＋负向词条） | 库内 `习惯/habits.json` |
| 系统层 | **全局知识库**（本目录＋Qbook） | 行业知识、手法套路、编辑视角、读者视角 | 31 个技能包＋Qbook 效率数据 | `skills/`（仓内，暂不开源）＋ `D:/Qbook/`（仓外） |

**规则归属变化**：原参考/约束里的规则类内容（写作纪律等）属「习惯」，不在世界书。

## 业务关联图（谁在消费哪些知识）

| 业务功能 | 消费的知识 | 通道 |
|---|---|---|
| Agent 对话/润笔/续写 | craft 类技能（按体裁匹配）＋ 习惯表＋世界书链接 | `systemPromptFor` 注入；习惯表在**任何成文产出前**强制注入 |
| 分析 verdict 层（OS-56/57） | fanqie-pattern-playbook 硬统计、de-ai-writing 清单、shuangwen-chapter-check 十项、reader-needs-ironrules 铁律、**习惯表**（禁用词/句式扫描＋口吻参数） | `analysis.mjs` 的 buildEditorial（每条 verdict 带 `source` 出处） |
| 推演/富化 | Pinax fact 推演链（core/pinax vendor）＋ TRACE_HEADER 溯源纪律 | `deduceEngine.mjs` / `enrichEngine.mjs` |
| 条目页签/拆解 | fact 数据契约 | core/pinax factFileStore |
| MCP 分发材料 | 上面所有模块的使用口径 | `mcp/skills/*.md`（这是对外材料，不是知识库本体） |

## 技能包清单（31 个，按用途）

- **审稿/检查**：shuangwen-chapter-check（十项自检）、fact-consistency、continuity-check、prose-continuity-rules、info-reveal-budget、fact-extraction-quality
- **改写/生成**：chapter-rewrite、scene-expand、outline-restructure、worldbook-refactor、humanizer、de-ai-writing
- **方法论**：pattern-design-method、fanqie-pattern-playbook（16 本硬统计）、reader-needs-ironrules（100 本效率反推）、screenplay-craft、storyboard-craft
- **文风包**（style-*，11 个）：尺芥入松/大秦谣愿/风披反拍/换亲暴富/末世弹幕/年上隐市/热晋直/山干观场/上交国家/忘不掉白月/一手遮成
- **规则题材**：rule-horror-cold-prose

## 红线

1. 全局知识库（本目录＋Qbook）**暂不开源**——分发打包时排除 `skills/`（mcp/skills 分发材料保留）。
2. 编辑 verdict 的判定规则**必须**能追溯到上表某个来源（技能文件/Qbook 统计/用户习惯表），严禁凭空造规则。
3. 习惯表是作者亲自定的规矩——与任何默认风格冲突时，**习惯表赢**。
