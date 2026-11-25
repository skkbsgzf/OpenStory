---
name: chapter-rewrite
description: 按作者给的方向重写一整章，结果只落成提案，作者采纳才进正文。
tools: [openstory_novel_read_chapter]
output: proposal
domain: prose
category: transform
genres: ["*"]
vendor: skkbsgzf
version: 0.1.0
---

## 何时用

作者说「这一章重写」「按这个方向再写一遍」「把开头改狠一点」时。

## 可用性

`openstory_novel_read_chapter` 可读取原章。OpenStory 当前没有可直接保存改写稿的工具，该保存能力不可用；重写稿只在回复中作为提案交付，由作者采纳，不自动落盘。

## 步骤

1. 用 `openstory_novel_read_chapter` 读原章，记下字数；需要前后文时再读相邻章。
2. 先复述这次要改的三件事（视角、节奏、具体段落），一句话一条，等作者点头或按原指令执行。
3. 写完整一章作为提案，不直接覆盖正文，也不声称已经保存。
4. 告诉作者改动幅度（字数变化）与主要调整点，并给出完整重写稿供作者采纳。

## 禁止

- 不越过提案直接声称「已改好正文」。
- 不删改其他章节，不顺手重排结构。
- 不复用旧稿里没过审的句子来凑字数。

## 数据契约

契约登记在 `next/skills/contracts.mjs`（`SKILL_CONTRACTS['chapter-rewrite']`），装配方按它裁剪事实包：

- requires：plot 层（当前章事件，跨度 `current + before:1 + after:1`）＋ character 层（全场角色锚点，`knowledgeOf: cast`）。
- produces：`plot` 正文增量（`mode: author`，落 `draft`）；触发新设定时另出 `worldview` 条目（`mode: author`，落 `proposed`，不直写 adopted）。
- 文风约束不在 fact 三层里（ADR S1 已把 style 解耦到能力包）：由装配方从文风能力包另行补给，不塞进事实包。
