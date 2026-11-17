# 推演与数据：需求规划（OS-54 后）

> 2026-11-18 · 作者裁定条目/Wiki 工作面剔除后，推演与 fact 数据成为「事实链」仅存的两个出口。
> 本文档盘点现状、列已知问题、给分期规划——待作者裁定优先级后分批实施。

## 一、现状盘点

### 1. 数据侧（fact 链，全部保留且健康）

| 件 | 位置 | 状态 |
|---|---|---|
| 拆解真源 | `<库>/拆解/<bookId>.json`（fact.data/v3：book/source/entries/revision，wiki 旁挂 `<id>.wiki.json`） | ✅ 稳定 |
| factFileStore | core/pinax/next/kernel/factFileStore.mjs（list/get/revision，坏档跳过记 warning） | ✅ 稳定 |
| factGuard | factGuard.mjs：factHealth（revision/stale 判定）→ chapterPut 回填 factStale | ✅ 稳定 |
| enrich | 三端点 run/status/graph：六槽位窄窗 LLM 富集 → wiki 旁挂（章摘要/人物档/伏笔/因果图/台账） | ⚠️ 仅 endpoint 型 runtime 可跑（cli/dsh 如实拒） |
| fact 曲线 | /api/fact/curve：plot 条目按章计事件＋foreshadows＋章摘要 → 分析面板「剧情曲线」 | ✅ 分析面板第一卡 |
| 参考图谱 | 条目作为只读节点参与（buildReferenceGraph entries 参数） | ✅ |

**剔除后的数据出口**：推演页（POV/局面/候选）、分析面板（剧情曲线/情绪密度）、参考图谱（entry 只读节点）、Agent 上下文（参考索引段附图谱边）。

### 2. 推演侧（deduceEngine.mjs + 推演页双模）

- 引擎链：loadEntries → openDeduceSession（worldview 必需）→ presentTurn（三层候选：必然/命运/戏剧）→ settleChoice → fronts/张力/AI 预算
- 会话：`<库>/.openstory/deduce/<bookId>.json`（原子写，一库一书一文件）
- 前端：引擎态（POV/种子/局面卡/候选行带 2d6 trace）＋ Agent 态（自由文本流→手工转待确认卡）
- 本批新增：POV 智能缺省（出场最多角色）、characters 随 present 响应、bookId 后端解析（mtime 最新）

## 二、已知问题（按影响排序）

1. **「戏剧」候选永远为空**：presentTurn 未接 llmPort，candidates.js 无模型时戏剧候选直接返回 []——三层候选实际只有两层，UI 的「AI 预算」恒 0/8。
2. **结算产物被丢弃**：settleChoice 产出的事件条目只打 hint（「不自动写库」），不落拆解、不转卡、不展示——推演的结果无法沉淀进事实链。
3. **Agent 模式是自由文本流**：拼 prompt 走 streamChat，回复靠手工转卡，无结构化分支输出。
4. **会话管理缺位**：一库一书一文件，只有整局重开；无会话列表/多局并存/删除。
5. **前线（fronts）只读**：引擎产出 fronts 但 UI 只展示，没有「推进/解决」交互。
6. **与正文零联动**：推演结算不写正文提案；正文章写完后也没有「进推演」的入口（两套循环脱节）。

## 三、规划（建议分期，每期独立可验）

### P1「推演成果落地」——修问题 2（价值最高）

结算产物是整个推演闭环的缺口：

- settleChoice 的事件条目 → **转待确认卡**（复用 OS-24 卡机制：目标=拆解/…json 的 entries 增量），
  采纳走 factFileStore 的写协议（revision+operationId）；拒绝则丢弃
- 结算后自动刷新 factStale 闸（正文比对拆解 mtime 的口径要同步考虑）
- UI：结算行显示「已转为待确认卡」入口

验收：推演一拍→选候选→结算→卡出现→采纳→拆解 json revision+1→曲线/图谱即时反映。

### P2「戏剧候选接通」——修问题 1

- deducePresent 接受可选 llmPort（endpoint 型 runtime 时传入），candidates.js 的 dramaCandidates 走真模型
- AI 预算（budgetMax/aiSpent）随真实调用扣减；无模型时 UI 如实标「戏剧候选需模型（当前不可用）」而非恒 0
- 成本护栏：单次 drama 候选数上限、超时回落两层

### P3「会话管理」——修问题 4

- 会话文件按 `<bookId>/<sessionId>.json` 分局；推演页头部会话下拉（复用 Agent 会话下拉的交互）
- 新开/删除/切换；列表显示 round 与最后活动时间

### P4「数据面板」——条目浏览的合规回归

剔除条目页签删掉的是「通用文本框式浏览」；数据需要一个**分析形态**的家：

- 落点候选 A：分析面板加「数据」模块卡（与剧情曲线并列，模块可插拔）——fact 总览
  （bookId/revision/条目分层计数/富集状态/lastStale）＋条目清单表（搜索/层筛选）
- 落点候选 B：独立「数据」页签（信息架构上与推演并列：推演=消费数据，数据=盘点数据）
- 只读（fact 写协议只有 enrich 与 P1 的卡采纳两条路，不开放手编）
- 图谱 entry 节点的「打开详情」改跳这里

倾向 A（不新增页签，分析面板已是模块化插拔）。待作者裁定。

### P5「推演×正文联动」——修问题 6

- 推演结算卡可选「写进正文提案」（场景卡→章节提案，走既有待确认卡通道）
- 正文页每章尾部「拿这一章进推演」：以本章内容为新拍种子（present 带 chapterSeed）

### 暂不做

- Agent 模式结构化（问题 3）：引擎模式成型后再评估是否保留 Agent 模式
- fronts 交互（问题 5）：依赖 P1 的结算落地先通
- 多书同库多会话并存：一库一书口径先稳住

## 四、风险与依赖

- factFileStore 写协议（operationId/revision）目前只有 enrich 在用——P1 采纳卡是第二个写入方，
  需要并发写测试（两路同时结算）
- enrich 依赖 endpoint 型 runtime；DSH 原生 runtime 跑不了 enrich——P2 的戏剧候选同限制
- 拆解 schema 若演进（fact v4），曲线/推演/图谱三处消费方要同步
