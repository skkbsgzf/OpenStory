---
name: continuity-check
description: 连续性核对：把正文与大纲、世界书对一遍，只出问题清单，不改任何文件。
tools: [openstory_novel_read_chapter, openstory_reference_index]
output: checklist
domain: acceptance
category: review
genres: ["*"]
vendor: skkbsgzf
version: 0.1.0
---

## 何时用

作者说「查一下有没有前后矛盾」「这段和设定对得上吗」时。

## 可用性

OpenStory 当前没有自动读取项目概览与大纲的工具，相关自动能力不可用。项目概览与大纲要点须由作者提供；章节和世界书分别用 `openstory_novel_read_chapter`、`openstory_reference_index`／`openstory_reference_read_note` 核对。

## 步骤

1. 先确定作者本次要核对的章节范围与大纲要点；材料不全时只核对已有依据，不假装完成全书检查。
2. 只报三类问题：事实冲突（年龄、地点、时间线）、设定越界（正文用了世界书里没有的能力或名词）、伏笔断线（大纲里有、正文没接）。
3. 每条写成一行：问题 → 依据（哪一章／哪一条目）→ 一句话建议。
4. 结尾用数字收口：核对了几章、报了几条。

## 禁止

- 不改任何文件，不生成提案。
- 不把「读起来不顺」算成连续性问题——那是文风，另说。
- 没有依据的怀疑不报；宁可少报，不编证据。

## 数据契约

契约登记在 `next/skills/contracts.mjs`（`SKILL_CONTRACTS['continuity-check']`）：

- requires：worldview／character／plot 三层全覆盖——双时间轴用条目 `validity` 与查询时点相交判定，知情矩阵取全场角色（`knowledgeOf: cast`），有效性区间随投影返回。
- produces：非条目产物 `violation-list`（output: checklist）。它包装 `fact/usecases/precheck.js` 的结果，不落 fact store；契约里用 `nonEntry` 声明，避免被当成条目误落库。
