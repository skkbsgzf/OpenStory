# 创作知识库（内部）——资产盘点与业务关联

> **定位（OS-57，作者口径）**：本目录＝**全局知识库**的仓内部分，系统内部级别，**暂不开源**。
> 它不给终端功能当数据用，而是给各功能的**提示词/判定规则**当源头——写提示词时尽可能参考这里。
> 另一大半在仓外的 Qbook（`D:/Qbook/短篇选题库/`：市场效率数据＋分析报告＋拆解 wiki）。

## 三层知识架构（作者裁定）

| 层 | 名称 | 归属 | 内容 | 存储 |
|---|---|---|---|---|
| 项目层 | **世界书** | 每个库自己的创作型条目管理知识库 | 人物/场景/事件/大纲等条目，Obsidian 式标签双链 | 库内 `世界书/` 目录 |
| 项目层 | **习惯** | 每个库自己的写作习惯表 | 文风自述、禁用词、惯用词、禁用句式、禁用修辞、描述公式（正向＋负向词条） | 库内 `习惯/habits.json` |
| 系统层 | **全局知识库**（本目录＋Qbook） | 行业知识、手法套路、编辑视角、读者视角 | 31 个技能包＋Qbook 效率数据 | `skills/`（仓内，暂不开源）＋ `D:/Qbook/`（仓外） |

**规则归属变化**：旧版规则类目录（写作纪律等）里的规则内容已一次性迁入「习惯」，不在世界书；这些旧目录名只作一次性迁移输入，不再作为现行路径使用。

## 业务关联图（谁在消费哪些知识）

| 业务功能 | 消费的知识 | 通道 |
|---|---|---|
| Agent 对话/润笔/续写 | craft 类技能（按体裁匹配）＋ 习惯表＋世界书链接 | `systemPromptFor` 注入；习惯表在**任何成文产出前**强制注入 |
| 分析 verdict 层（OS-56/57） | fanqie-pattern-playbook 硬统计、de-ai-writing 清单、shuangwen-chapter-check 十项、reader-needs-ironrules 铁律、**习惯表**（禁用词/句式扫描＋口吻参数） | `analysis.mjs` 的 buildEditorial（每条 verdict 带 `source` 出处） |
| 推演/富化 | 本仓自持 fact 推演链（原出处见 `docs/kernel-provenance.md`）＋ TRACE_HEADER 溯源纪律 | `src/modules/deduce/deduceEngine.mjs` / `src/services/enrichEngine.mjs` |
| 条目页签/拆解 | fact 数据契约 | `src/modules/fact/`（自持实现，出处见 `docs/kernel-provenance.md`） |
| MCP 分发材料 | 上面所有模块的使用口径 | `docs/mcp/*.md`（这是对外材料，不是知识库本体） |

## 技能包清单（31 个内置 ＋ 2 个套件捆绑，按用途）

- **审稿/检查**（review/extract）：shuangwen-chapter-check（十项自检）、fact-consistency、continuity-check、prose-continuity-rules、info-reveal-budget、fact-extraction-quality
- **改写/生成**（transform/craft）：chapter-rewrite、scene-expand、outline-restructure、worldbook-refactor、humanizer、de-ai-writing
- **方法论**（craft）：pattern-design-method、fanqie-pattern-playbook（16 本硬统计）、reader-needs-ironrules（100 本效率反推）、screenplay-craft、storyboard-craft
- **文风包**（style-*，11 个）：尺芥入松/大秦谣愿/风披反拍/换亲暴富/末世弹幕/年上隐市/热晋直/山干观场/上交国家/忘不掉白月/一手遮成
- **规则题材**：rule-horror-cold-prose
- **操作说明书**（operate）：由 OS-216/OS-223 分别建 `build-project` / `update-project`；**当前内置货架 31 个里暂无 operate 正片**，先用临时夹具验证协议。operate 是只读说明书，不产出小说内容、不执行代码、不注入 prompt、不自动写盘；写操作只能调用 frontmatter `tools` 里声明的、在 MCP 安全语义注册表（`src/protocol/mcpToolSemantics.mjs`）里已分类的官方工具，并按 `confirm` 级别（read/create/migrate/restore，作为每个 MCP 工具的 `confirm` 实参传入；条件写必传，普通写传了就须满足门槛，不足返回 `CONFIRM_REQUIRED`）经作者确认。非法声明 fail-closed 拒绝装载。协议见 [PROTOCOL.md](PROTOCOL.md)。
- **套件捆绑 2 个**：写作套件 `beat-rhythm-review`、编剧套件 `dialogue-tighten`（随套件启停生效，**不计入 31 个内置**）。故 `openstory_skills_list` 可见总数为 **31 内置 ＋ 2 套件捆绑 ＝ 33**，另有套件随启停出现的口径以该端点为准。

## 推演文游素材绑定约定（OS-61 P4）

推演页「当前局面」是 galgame 式舞台：场景立绘＋对话框正文（打字机）＋在场人物头像列＋BGM。
素材**全部可选**，按名字与局面卡对上就自动上屏；缺失时前端用渐变占位块（不同 kind 不同色），不报错：

| 素材 | 路径约定 | 匹配规则 |
|---|---|---|
| 人物立绘/头像 | `推演/<bookId>/素材/角色/<角色名>.png` | 按局面卡 `who` 里的角色名精确匹配；缺失＝首字母圆牌 |
| 场景立绘 | `推演/<bookId>/素材/场景/<场景名>.png` | 按局面卡 `where` 精确匹配；缺失＝渐变占位＋场景名 |
| BGM | `推演/<bookId>/素材/bgm/<场景或情绪>.mp3` | 先按场景名，再按张力情绪（平静/升温/紧迫/一触即发），都没有取第一首；目录空＝开关禁用并提示「未配置 BGM」 |

- 盘点走 `GET /api/deduce/assets?root&bookId`，本体走 `GET /api/deduce/asset`（只收 .png/.mp3，路径逃逸拒收）。
- 素材到位后**零代码改动**换真图：丢文件、刷新页面即可。
- 生图接口经 `openstory_image_generate`（ComfyUI / OpenAI 兼容后端）调用，配置真源在本机 `agent-config.json`（endpoint/model/apiKey/ComfyUI 地址与工作流 JSON），生成结果落上述约定路径。**设置页「引擎与存储」导航页里会直接渲染这些字段的输入框**（页内小标题为「对话模型与运行时」，`public/views/settingsViews.mjs` 的 `settingsModelsSectionHtml`），不是只做指路；它们写入的机器级配置就是 MCP 生图实际读取的同一份，不另设第二份存储。

## 红线

1. 全局知识库（本目录＋Qbook）**暂不开源**——分发打包时排除 `skills/`（`docs/mcp/` 对外分发材料保留）。
2. 编辑 verdict 的判定规则**必须**能追溯到上表某个来源（技能文件/Qbook 统计/用户习惯表），严禁凭空造规则。
3. 习惯表是作者亲自定的规矩——与任何默认风格冲突时，**习惯表赢**。
