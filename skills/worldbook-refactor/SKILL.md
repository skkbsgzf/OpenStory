---
name: worldbook-refactor
description: 重构世界书：拆分过长的条目、合并重复设定、补齐条目之间的关系。
tools: [openstory_reference_index, openstory_reference_read_note]
output: proposal
domain: worldbook
category: transform
genres: ["*"]
vendor: skkbsgzf
version: 0.1.0
---

## 何时用

作者说「这个人物条目太长了」「两个条目说的是同一件事」「给这两条补上关系」时。

## 可用性

清单与读取分别使用 `openstory_reference_index`、`openstory_reference_read_note`；OpenStory 当前没有可直接保存重构结果的工具，该保存能力不可用，重构结果只出提案，不自动写入。

## 步骤

1. 用 `openstory_reference_index` 看清条目清单，再用 `openstory_reference_read_note` 逐个读取涉及条目。
2. 给出变更表：拆分（原条目 → 新条目名与各自范围）、合并（谁并进谁、保留哪个名字）、补边（A 与 B 是什么关系）。
3. 确认后在回复中给出逐条提案，标明原条目与拟改内容，不批量覆盖、不直接写库。
4. 汇总：拟动几个条目、新增/删除各几个。

## 禁止

- 不改既有条目的既定事实（年代、身份、因果），只动组织方式。
- 不合并两个来源不同、作者没说清归属的条目——先问。
- 不把正文段落整段搬进世界书。

## 数据契约

契约登记在 `next/skills/contracts.mjs`（`SKILL_CONTRACTS['worldbook-refactor']`）：

- requires：worldview 层全槽位投影（不写 slots＝完全不限槽位；有序槽位按 rank 给出 ordered）。
- produces：`worldview` 条目提案（`mode: author`，落 `proposed`）；拆分／合并／补边都以提案形式出现，作者采纳才进 store。
