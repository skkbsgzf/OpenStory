# 遗留台账（OS-133 收官判定）

> OS-123→133 解耦与治理批次收官（2026-11-23）。这份文档是「没做完/不做」事项的**唯一台账**：
> 凡不在三档之内的事，等于「已做完且有测试与门禁护栏」。新事项先入档再动工。

## 【作者动作】——需要作者在真实环境验证一次

| 事项 | 现状与依据 | 风险 |
|---|---|---|
| **用 Pinax 桌面端打开 OpenStory 新建库，确认能认** | `.pinax/project.json` 落盘格式是与 Pinax 桌面端的双向兼容契约（spec `pinax-project@3`、schemaVersion 3、字段名与顺序、carriers{primary,enabled,revision}，见 `projectDoc.mjs`）。OS-124 建库自持时已用**金样护栏** `test/decoupleStep2.test.mjs` 把删除前内核建库输出冻结为逐字段相等的断言；但金样只证明「格式逐字段相等」，没证明「桌面端真读了一次」。 | 低——金样已证逐字段相等；缺的只是作者拿真桌面端开一次库的人肉确认。 |

## 【后续可选】——有真实价值、无明确排期；动工前先在此登记

| 事项 | 现状 | 依据 |
|---|---|---|
| **AG-UI 对接第三方消费者** | AG-UI 协议出口已接入：`agentEvents.mjs` 内部事件模型是 canonical（唯一真源），daemon SSE 帧已是它的投影（OS-128/131）。但至今**没有任何第三方客户端**消费 AG-UI 帧——协议出口在等一个真实消费者，在此之前不扩面。 | `agentEvents.mjs:1-20`（定位注释「未来第三方客户端…」） |
| **漂移「上游已移位」的长期处置** | `npm run vendor:check` 会报 `[上游已移位]`（锚里有、本仓还在、上游已无）——如 `enrich/{metrics,pseudoChapters}.mjs`（OS-FACT 批次入库，上游从未有）。该档**仅信息级，不影响 exit code**；若未来此类文件增多，需要决定「转为正式自持（出 core/）」还是「维持 vendor 形态」，目前维持现状。 | `core/VENDORED.md` OS-132 节；`scripts/vendor-drift.mjs` |
| **fs.watch 常驻监听** | 外部编辑（VSCode 改文件）不感知：参考索引只有本页编辑后 1.6s 防抖重扫。常驻 fs.watch 是候选修法，但会带来监听器生命周期与跨平台噪声问题，未做——现状「手动刷新可用」。 | `docs/AUDIT-SYNC.md` 缺口 3「外部编辑参考笔记不感知」 |
| **MCP 写工具扩面** | MCP 24 工具读写分级：读自由、写有 .history 备份语义、absorb/agent 对话不开。写面保持最小（正文/参考回写），更多写操作（如批量回填、条目删除）走界面——外部 agent 的写越少，稿子越安全。扩面前先想清楚备份语义是否覆盖。 | `mcp.mjs:1-25`（读写分级红线）；`docs/ACCEPTANCE.md` |
| **故事源大纲双向编辑** | 故事源三形态（大纲/表格/图表）是从 fact 条目＋wiki 章纲**只读算出**的投影；「在大纲里改字→写回 fact 条目」未实现，目前只能手动改条目。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「故事源文本→fact 条目（未实现）」 |
| **fact 增量 PATCH** | fact 写通道是整文件写（revision 自增＋operationId 幂等＋expectedRevision 乐观并发）。条目数大之后整文件写放大，可选做增量 PATCH——但会动内核写协议（S2 writeFactFile），属跨仓契约变更，须上游一起动。 | `core/pinax/next/kernel/factFileStore.mjs:10-12`；`pinaxAdapter.mjs:44-45` |
| **多轨并行图** | 关系图谱是「笔记＋拆解词条」同图单视图；角色时间线已有泳道图（storySource 事件面积图＋泳道）。「多轨并行」（多条剧情线并行推进的专用视图）未做，等真实创作需求出现再排。 | `public/storySource.mjs`（泳道）；`public/graph.mjs`（单图） |
| **世界书人物单页档案** | 人物信息分散在：参考笔记（自由书写）＋拆解词条（fact 条目详情）。「按人物聚合的单页档案」（一处看全某人设定/事件/关系）未做——与「fact 条目→参考笔记」缺失转换同源，都是 fact↔笔记的单向缺口。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「fact 条目→参考笔记（未实现）」 |
| **任务中心扩任务类型** | jobCenter 是通用后台任务容器（kind: image/vision/enrich/import/…），前端悬浮球轮询。加新任务类型＝纯增量（submitJob 带新 kind），无架构障碍——只是没有想做的任务，先空着。 | `jobCenter.mjs:9-10,57` |

## 【明确不做】——有理由的否决，勿再提议；翻案需作者裁定

| 事项 | 为什么不做 | 对标依据 |
|---|---|---|
| **插件签名体系** | 本仓没有第三方插件分发场景：货架是本机目录＋内置样例，凭据只存本机。签名解决的是「分发渠道被投毒」，这里没有渠道就没有这个威胁模型——做签名是替不存在的场景付成本。能力约束走 OS-129 白名单（capabilities 声明对齐宿主真实实现）。 | `docs/plan/opendesign-architecture-20261122.md` §5「明确不建议抄的」；`docs/plan/plugin-governance-benchmark-20261122.md` §5 |
| **Next.js（或任何构建链）** | 零 npm 构建依赖是本仓宪法（作者口径「完全本地」）。OpenDesign 用 Next.js 是因为它要做 Web 产品＋桌面壳双轨（141 MB standalone 产物）；OpenStory 单页＋无构建即可覆盖全部功能，换框架只引入构建产物与 SSR 概念，无功能收益。 | `docs/plan/opendesign-architecture-20261122.md` §5 |
| **154 设计系统包的规模** | OpenDesign 的 154 个设计系统是**产品面**（海量主题货架），不是架构面。OpenStory 的口径是：语义令牌单一真源（`public/index.html` `:root`＋`design-system/tokens.css`）＋风格包按需覆盖——令牌机制同源，规模不跟。 | `docs/plan/opendesign-architecture-20261122.md` §5、§附实测出处 |
| **Obsidian 式无白名单 API** | Obsidian 插件可直接 `require('fs')`、读写任意文件、发任意请求，靠社区审核兜底，历史上多次恶意插件事件。OpenStory 走能力白名单：插件 capabilities 声明、宿主按声明加载（OS-129），声明之外没有能力——安全边界前置到加载期，而不是事后审核。 | `docs/plan/plugin-governance-benchmark-20261122.md` §5「不抄第一件」 |

——
维护约定：三档之外无灰区。某条【后续可选】动工时，把它从表里挪进对应批次的交付说明；
做完就删行。【明确不做】的翻案需作者明示，翻案后在行内补记日期与理由。
