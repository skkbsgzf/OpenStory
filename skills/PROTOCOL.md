# Skill 货架协议 · openstory-skill@1

> 技能＝可执行的**手艺配方**（不是知识、不是规则数据）。stylekit 的 `craft` 层从这里取。
> 与套件/体裁/风格包同口径：目录制、本机可覆盖、坏档跳过。

## 注册方式

```
skills/<skill-id>/SKILL.md         ← 内置（随仓）
%LOCALAPPDATA%/OpenStory/openstory/skills/<skill-id>/SKILL.md   ← 本机
```

一个 skill ＝ 一个目录＋`SKILL.md`（Markdown＋YAML frontmatter）。可带 `references/`、`scripts/` 等附属文件。

## frontmatter 字段

```yaml
---
name: screenplay-craft            # 必填，[\w-]
description: 一句话说明（何时该用它）
version: 0.1.0                    # 三段数字
vendor: skkbsgzf                 # 归属
category: craft                   # craft｜review｜transform｜extract｜operate
genres: ["*"]                     # 兼容体裁（genres/*.json 的 id；* 全兼容）
stage: draft                      # 可选：构思 outline｜设计 design｜草稿 draft｜修订 revise
tools: [openstory_novel_read_chapter]   # 可选：官方 MCP 工具名（openstory_*），operate 必填
confirm: read                     # 可选：read｜create｜migrate｜restore（写工具必须非 read）
output: proposal                  # 可选：产物形态（proposal/checklist/data/manual）
domain: prose                     # 可选：业务域提示
---
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✓ | 与目录名一致（宿主校验） |
| `description` | ✓ | 何时用——Agent 靠它选技能 |
| `category` | ✓ | `craft`（技法规则，可进 instruction）/`review`（审阅，只出问题清单）/`transform`（改写，产提案）/`extract`（抽取，产数据）/`operate`（项目构建/升级说明书，只读） |
| `genres` | | 兼容体裁；缺省 `["*"]` |
| `stage` | | 流水线阶段提示（推演/写作时按阶段挂载） |
| `tools` | operate 必填（非空） | 字符串数组，元素必须是真实存在的官方 MCP 工具名（`openstory_*`）；operate 必须非空且全部已分类。坏形状/未知工具/未分类工具/伪装成工具的 shell/fs 词＝**拒绝装载（fail-closed）** |
| `confirm` | | 确认级别：`read`（只读，缺省）/`create`（新建）/`migrate`（结构迁移）/`restore`（从备份恢复）；读 < create < migrate < restore。声明写工具必须达到该工具的最低门槛（`src/protocol/mcpToolSemantics.mjs` 单一注册表）；不满足＝**拒绝装载** |
| `output` / `domain` | | 产物形态与业务域提示，纯说明 |

## 五类 skill 的边界（重要）

- **craft**（技法）：可执行规则 → stylekit 装配时进 **instruction 块**（过守卫）
- **review**（审阅）：只读，只出问题清单，**绝不改文件**（如 continuity-check）
- **transform**（改写）：产物是**提案**，作者采纳才落盘（如 chapter-rewrite）
- **extract**（抽取）：产出结构化数据（如 fact-extract）
- **operate**（操作说明书）：项目构建/升级指引——**只读说明书，不产出小说内容，不执行代码（禁止 shell/fs 直写、eval/Function、脚本），不自动注入 prompt**；
  只能由 Agent 按需 `openstory_skills_read` 读取。所有写操作只能调用 `tools` 里声明的官方 MCP 工具，
  并按 `confirm` 级别经作者确认（实参放在每个 MCP 工具的 `confirm` 字段；条件写必传，普通写传了就必须满足门槛，不足返回 `CONFIRM_REQUIRED`）；
  `read` 之外一律先向作者展示计划、拿到确认再调用。

**只读类**（review/extract）不得声明写工具或写确认级别；craft/transform 也不得声明写工具
（它们只出规则/提案，不获得写权）。写工具（`openstory_novel_write_chapter`、
`openstory_novel_delete_chapter`、`openstory_reference_write_note`、`openstory_habits_put`、
`openstory_image_generate`、`openstory_deduce_present` 等——完整表见 `src/protocol/mcpToolSemantics.mjs`）
出现在只读类／craft／transform，或确认级别低于门槛＝**拒绝装载**。

**安全语义违规一律 fail-closed**：非法形状、未知/未分类工具、shell/fs 伪装、写工具无确认或
确认不足、只读类写工具或写确认，加载器直接拒收，不能只 warning 照装。
`deduce_present` 正常续拍会保存会话状态（按写工具 create 确认）；`reset=true` 清盘，升到
`restore` 确认；无法参数化的工具整体按写工具算。
工具的效果 `effect` 与最低确认 `requiredConfirm` 只在单一注册表 `src/protocol/mcpToolSemantics.mjs`
声明；MCP 工具表与该表双向校验（多一个/少一个都拒绝启动）。

## 工具白名单门禁（OS-212）

1. `SKILL_CATEGORIES` 与本表 category 列必须逐项一致（多一项/少一项＝红）。
2. `tools` 声明的每个工具名必须在 MCP 注册表 `MCP_TOOL_NAMES`（`src/host/mcp.mjs`）里真实存在，
   且必须在 `src/protocol/mcpToolSemantics.mjs` 里已分类——未知/未分类＝红。
3. 声明写工具必须达到该工具的 `requiredConfirm`；只读类（review/extract）、craft、transform
   声明任何写工具或写确认＝红。
4. `craftInstructionBlock()` 只收 `craft`；`operate` 永不进 prompt，只能按需读取。

门禁在 `test/skills.test.mjs` 与 `test/mcp.test.mjs` 里执行；加载器对安全语义违规 fail-closed，
不持有 MCP 实现，也不靠工具名前缀猜读写——坏声明直接拒收，不悄悄放宽。

## 当前货架

31 个内置 skill ＋ 2 个套件捆绑 skill（写作/编剧套件各 1）。下表列工具型/方法型代表，
完整清单以 `openstory_skills_list` 为准：

| skill | category | 来源 | 说明 |
|---|---|---|---|
| chapter-rewrite | transform | skkbsgzf | 按作者方向重写整章，只出提案 |
| continuity-check | review | skkbsgzf | 正文 vs 大纲/世界书连续性核对，只出问题清单 |
| fact-consistency | review | skkbsgzf | 整库一致性检测（锚点/规则/时间线/知情） |
| fact-extract | extract | skkbsgzf | 从正文联合抽取剧情/人物/设定/关系/伏笔 |
| outline-restructure | transform | skkbsgzf | 大纲合并/拆分/重排，保留节点 id |
| scene-expand | transform | skkbsgzf | 一句梗概扩写成一场戏，出提案 |
| worldbook-refactor | transform | skkbsgzf | 世界书拆条/合并/补关系 |
| humanizer | transform | CodeBuddy 官方 | 去 AI 写作痕迹（基于 Wikipedia「Signs of AI writing」），只产改写提案 |
| screenplay-craft | craft | DeepSeek 蒸馏 | 影视编剧 SOTA 技法（三幕/15拍/场景/对白/弧光/钩子） |
| storyboard-craft | craft | DeepSeek 蒸馏 | 影视分镜 SOTA 技法（景别/机位/运镜/构图/竖屏/漫剧分格） |
| de-ai-writing | craft | DeepSeek 蒸馏 | 中文去 AI 味检查清单（高频词/套话/三段式/替换策略） |
| build-project（OS-216 建） | operate | 官方 | 项目构建说明书（只读，写操作走声明的 MCP 工具） |
| update-project（OS-223 建） | operate | 官方 | 项目升级/迁移说明书（只读，写操作走声明的 MCP 工具） |

> `build-project` / `update-project` 由后续工单创建，本单只立协议；尚未落盘前用临时 fixture 验证。

## 与 stylekit 的关系

stylekit 的 `knowledge.refs[].role: "craft"` 可以引用 skill；装配时按 `compat.genres` 过滤，
`category: craft` 的进 instruction（过守卫），`review/transform/extract/operate` 作为工具型配方按需调用，
`operate` 永不自动注入。
