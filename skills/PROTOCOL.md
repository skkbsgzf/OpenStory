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
category: craft                   # craft｜review｜transform｜extract
genres: ["*"]                     # 兼容体裁（genres/*.json 的 id；* 全兼容）
stage: draft                      # 可选：构思 outline｜设计 design｜草稿 draft｜修订 revise
---
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✓ | 与目录名一致（宿主校验） |
| `description` | ✓ | 何时用——Agent 靠它选技能 |
| `category` | ✓ | `craft`（技法规则，可进 instruction）/`review`（审阅，只出问题清单）/`transform`（改写，产提案）/`extract`（抽取，产数据） |
| `genres` | | 兼容体裁；缺省 `["*"]` |
| `stage` | | 流水线阶段提示（推演/写作时按阶段挂载） |

## 三类 skill 的边界（重要）

- **craft**（技法）：可执行规则 → stylekit 装配时进 **instruction 块**（过守卫）
- **review**（审阅）：只读，只出问题清单，**绝不改文件**（如 continuity-check）
- **transform**（改写）：产物是**提案**，作者采纳才落盘（如 chapter-rewrite）
- **extract**（抽取）：产出结构化数据（如 fact-extract）

**禁止**：skill 不得写正文、不得改配置、不得调用网络（除显式声明的工具）。

## 当前货架

| skill | category | 来源 | 说明 |
|---|---|---|---|
| chapter-rewrite | transform | skkbsgzf | 按作者方向重写整章，只出提案 |
| continuity-check | review | skkbsgzf | 正文 vs 大纲/世界书连续性核对，只出问题清单 |
| fact-consistency | review | skkbsgzf | 整库一致性检测（锚点/规则/时间线/知情） |
| fact-extract | extract | skkbsgzf | 从正文联合抽取剧情/人物/设定/关系/伏笔 |
| outline-restructure | transform | skkbsgzf | 大纲合并/拆分/重排，保留节点 id |
| scene-expand | transform | skkbsgzf | 一句梗概扩写成一场戏，出提案 |
| worldbook-refactor | transform | skkbsgzf | 世界书拆条/合并/补关系 |
| humanizer | transform | CodeBuddy 官方 | 去 AI 写作痕迹（基于 Wikipedia「Signs of AI writing」） |
| screenplay-craft | craft | DeepSeek 蒸馏 | 影视编剧 SOTA 技法（三幕/15拍/场景/对白/弧光/钩子） |
| storyboard-craft | craft | DeepSeek 蒸馏 | 影视分镜 SOTA 技法（景别/机位/运镜/构图/竖屏/漫剧分格） |
| de-ai-writing | craft | DeepSeek 蒸馏 | 中文去 AI 味检查清单（高频词/套话/三段式/替换策略） |

## 与 stylekit 的关系

stylekit 的 `knowledge.refs[].role: "craft"` 可以引用 skill；装配时按 `compat.genres` 过滤，
`category: craft` 的进 instruction（过守卫），`review/transform/extract` 作为工具型配方按需调用。
