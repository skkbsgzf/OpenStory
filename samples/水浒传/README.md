# 演示库 · 水浒传（前 10 回唯一事实源 · MCP-only 重建）

OpenStory 的示例库（公版内容，可自由使用）。用库切换器 → 导入库 → 选本目录即可打开。

## 这个样本怎么来的

本目录**不是手搓业务文件**，而是由受版本控制的构建配方经真实 MCP 工具，从空目录重建：

```bash
node tools/verify/verify-shuihu-10ch.mjs --out <临时目录>
node tools/samples/install-shuihu-sample.mjs --candidate <临时目录> --recipe-10ch
```

- 建库、套件、习惯、18 篇世界书、**39 条合法 fact**、**第 1–10 回正文**、**第 1–10 回剧本**、
  会话/多局、归档、素材、exchange 导出全部来自 MCP 调用；构建脚本自身只创建隔离环境与审计文件。
- 113 次工具调用；语义 digest：`d7482f63cd590c755dd97454d96bd458c227a63feb644d25dc5e155ee7a60c10`。
- **唯一事实源＝前 10 回的事实链**（39 条 `fact.data/v3` 条目＋wiki 派生层）；正文只作逐字出处——遵循 [FACT-FIRST](../../docs/FACT-FIRST.md)。
- 主档与派生 wiki 的 revision 一致（1/1）；18 篇世界书、6 节点会话、第 1 章归档、2 个角色立绘、1 个场景图与 BGM 保留。
- 内容输入冻结在 `tools/samples/shuihu-input/`（第 1 回正文）与 `tools/samples/shuihu-input-10ch/`（第 2–10 回正文、第 1–10 回剧本）；
  事实链在 `tools/samples/shuihu-10ch-facts.mjs`，派生层在 `tools/samples/shuihu-10ch-wiki.mjs`。

## 剧本体量

10 回剧本按「场景 → 动作 → 对白 → 后果」写，不再是一幕两句话的骨架：

| 回 | 字数 | 幕 | 台词 |
|---|---:|---:|---:|
| 第一回 误走妖魔 | 2277 | 5 | 54 |
| 第二回 王进私走 | 2027 | 6 | 66 |
| 第三回 拳打镇关西 | 1892 | 6 | 54 |
| 第四回 大闹五台山 | 1927 | 6 | 62 |
| 第五回 倒拔垂杨柳 | 2031 | 5 | 61 |
| 第六回 误入白虎堂 | 2288 | 6 | 77 |
| 第七回 风雪山神庙 | 2023 | 6 | 53 |
| 第八回 智取生辰纲 | 2574 | 7 | 68 |
| 第九回 火并王伦 | 1733 | 4 | 56 |
| 第十回 宋江杀惜 | 2512 | 7 | 75 |

合计 21,284 字。`verify-shuihu-10ch.mjs` 有硬门槛（每回 ≥1500 字 / ≥4 幕 / ≥40 台词），退化会红。

## 配套知识库源

`knowledge-packs/shuihu-10ch/` 是同一事实链的产品侧投影，**跨项目只读知识库源**，可登记后可浏览/检索：

```bash
node tools/samples/build-shuihu-kb.mjs --out knowledge-packs/shuihu-10ch   # 从事实链重新生成
node tools/samples/build-shuihu-gold.mjs --out knowledge-packs/shuihu-10ch/gold.json
```

- `knowledge.base.json`（`openstory.knowledge-base@1`）＋ `docs/`（索引/章纲/人物/事件/设定/技法/干扰项）＋ `gold.json`。
- 登记只在知识库工作台经 **preview → confirm** 执行，不会被本样本或构建脚本自动登记。
- 知识库是跨项目资产，与作品世界书不共享数据语义，只共用中性 wiki 呈现层。

## 已知边界

- clean-room 使用**假文本上游**验证协议与落盘，不声称真实模型语义验收通过（`semanticModelVerified:false`）；**不 BYOK**。
- 黄金 query 的四门槛（来源正确率/负查询/Recall@5）尚无真实 embedding/LLM provider 跑通，见 `docs/workorders/stage-c-acceptance.md`；不把假上游写成真实验收。
- 识图/生图/enrich 的真实模型能力仍需作者配置；样本不伪造这些结果。
- 安装器在替换前保留同盘旧样本备份，全部校验通过后才换入；失败可回滚。

## 可以试什么

1. 世界书：18 篇条目、标签树、双链、反链与图谱。
2. 正文：第 1–10 回纯净写作面、习惯命中、分析面板、故事源三形态与回目对偶。
3. 剧本：第 1–10 回剧本（21,284 字，多幕多角色），可试剧本↔fact 互转。
4. 故事源：39 条合法事实、10 回章纲、剧情曲线、因果图、世界书关联与 wiki 派生。
5. 扮演：主线 6 节点、MCP 分局、第 1 章归档、角色/场景/BGM 素材。
6. 知识库：登记 `knowledge-packs/shuihu-10ch/` 后可浏览章纲/人物/事件/设定并检索。

详细操作见 [`docs/DEMO.md`](../../docs/DEMO.md)、[`skills/build-project/SKILL.md`](../../skills/build-project/SKILL.md) 与 [`docs/FACT-FIRST.md`](../../docs/FACT-FIRST.md)。
