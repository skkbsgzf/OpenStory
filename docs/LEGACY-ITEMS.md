# 遗留台账（截至 OS-165 · 段 C 收口现状）

> OS-123→133 解耦与治理批次建立本台账（2026-11-23），OS-165 按现状重审（2026-11-24）。
> 这份文档是「没做完/不做」事项的**唯一台账**：凡不在三档之内的事，等于「已做完且有测试与门禁护栏」。
> 新事项先入档再动工；做完就删行。本轮收口：段 B⁺／C（OS-157～165）全部有测试与门禁护栏，不入档。

## 【已裁定】——作者裁定固化，细节以 ADR 为准（裁定本身不是待办）

| 裁定 | 日期 | 去向 |
|---|---|---|
| **G7 数据源归一：统一成 fact（合并路线）**——fact.data（v3/legacy v2）是唯一事实 schema；pedia/v1（NovelPedia）视为同源同质；OpenStory↔NovelPedia 导入导出一律走 fact.data/v3。 | 【已裁定 2026-11-23：统一成 fact】 | `docs/adr/0001-fact-schema-unification.md`。OS-162 已落地薄适配器＋导入/导出端点（共用 fact 写通道，非第二套写逻辑）；唯一仍开放项＝**拿 NovelPedia 真实数据跑一次导出→导入回环复验**，见【作者动作】 |
| **模块闸库路径（OS-144 遗留，OS-165 审结）**——曾担心停用时拿不到库根、退回 daemon 默认库或清单第一条。 | 【已审结 2026-11-24：无残留】 | 41 个模块独占端点的契约 `request` **全部带 root**（脚本审计＋`test/moduleCoverage.test.mjs` 钉死），daemon 的模块闸优先取已授权的请求 root；MCP 分析工具不显式给 root 就完全不判定，绝不回落清单；`moduleHooks` 均由调用方传 root。`daemon.moduleGateRoot` 的「默认库＞第一条」只是无库上下文的老调用兜底，对独占端点不可达。无待办，不入档 |
| **旧院路径冻结（OS-166）**——品牌分家后不再有第二处 `join(base, 'PinaxNext', …)`。 | 【已裁定 2026-11-24：只拷贝不删除】 | `%LOCALAPPDATA%/PinaxNext/` 原样留给 Pinax 桌面端；`src/protocol/courtyard.mjs`（宿主门面 `src/host/courtyard.mjs`）是唯一解析源，首启一次性拷贝到 `%LOCALAPPDATA%/OpenStory/` 并写迁移标记，跳 `*.tmp-*`/`daemon.lock`。旧路径只留在历史文档与迁移常量里，产品代码零直拼（`test/courtyard.test.mjs`＋门禁 S2.1 护栏）。无待办，不入档 |
| **库清单分家（OS-167）**——`next-preferences.json` 不再是 OpenStory 的 root 授权来源。 | 【已裁定 2026-11-24：只读导入、不写回】 | 新院 `libraries.json` 是自持清单（`{schemaVersion,libraries:[{path,name,addedAt,source}]}`）；`OPENSTORY_PREFERENCES` 是唯一路径环境变量，旧 `PINAX_OS_PREFERENCES` 不回落。设置页 `/api/library/pinax-list` 逐个体检旧清单，`/api/library/pinax-import` 按勾选写新清单。互认靠库内 `.pinax/project.json`，不靠任何本机清单。无待办，不入档 |

## 【作者动作】——需要作者在真实环境验证一次

| 事项 | 现状与依据 | 风险 |
|---|---|---|
| **用 Pinax 桌面端打开 OpenStory 新建库，确认能认** | `.pinax/project.json` 落盘格式是与 Pinax 桌面端的双向兼容契约（spec `pinax-project@3`、schemaVersion 3、字段名与顺序、carriers{primary,enabled,revision}，见 `projectDoc.mjs`）。OS-124 建库自持时已用**金样护栏** `test/decoupleStep2.test.mjs` 把删除前内核建库输出冻结为逐字段相等的断言；但金样只证明「格式逐字段相等」，没证明「桌面端真读了一次」。 | 低——金样已证逐字段相等；缺的只是作者拿真桌面端开一次库的人肉确认。 |
| **NovelPedia 真实数据复验（OS-162 写入器落地后新开放）** | `src/modules/exchange/pediaAdapter.mjs` 与 `/api/exchange/import|export` 已落地，字段映射按 ADR 0001 附录 A 钉死（三层样本、id 不变、style 单列、丢失字段清单），测试用合成夹具。真实 NovelPedia 书库里可能还有附录没覆盖的边缘字段/编码，需要作者拿一本真书跑一次「导出→再导入」回环。 | 中——合成样本过不代表真实数据过；回环只读一次，不阻塞日常写作。 |

## 【后续可选】——有真实价值、无明确排期；动工前先在此登记

| 事项 | 现状 | 依据 |
|---|---|---|
| **AG-UI 对接第三方消费者** | AG-UI 协议出口已接入：`agentEvents.mjs` 内部事件模型是 canonical（唯一真源），daemon SSE 帧已是它的投影（OS-128/131）。但至今**没有任何第三方客户端**消费 AG-UI 帧——协议出口在等一个真实消费者，在此之前不扩面。 | `agentEvents.mjs:1-20`（定位注释「未来第三方客户端…」） |
| **RAG 导出端点（OS-165 新开放）** | ADR 0001 §五已落地 `/api/exchange/export`（pedia/v1 与 JSONL 两个出向格式），但面向 RAG 的专用导出仍标「规划」——它的目标消费者、切块粒度与检索契约都还没定，先不做空壳端点。 | `docs/adr/0001-fact-schema-unification.md` §五；`src/api/contracts/exchange.mjs` |
| **自动化 UI 测试（OS-165 新开放）** | 当前护栏是 Node 测试（660 例）＋验收门禁（23 项）＋纯视图金样；浏览器侧只有人工冒烟（OS-157 按能力记录）。没有 Playwright 一类的端到端点击测试——引入它要带浏览器依赖与构建链，与「零构建依赖」宪法冲突，等真实回归痛点出现再评估。 | `test/*.test.mjs`；`tools/acceptance/acceptance.mjs`；OS-157 验收记录 |
| ~~漂移「上游已移位」的长期处置~~（OS-157 已结案） | vendor 漂移检测随 `core/`、`vendor/` 与 `npm run vendor:check` 整体退役；`enrich/{metrics,pseudoChapters}.mjs` 等本仓入库件已是有据可查的自有内核，出处见 `docs/kernel-provenance.md`。互认锚改由落盘格式金样承担。 | `docs/kernel-provenance.md`；`docs/error-code-rename.md` |
| **fs.watch 常驻监听** | 外部编辑（VSCode 改文件）不感知：参考索引只有本页编辑后 1.6s 防抖重扫。常驻 fs.watch 是候选修法，但会带来监听器生命周期与跨平台噪声问题，未做——现状「手动刷新可用」。 | `docs/AUDIT-SYNC.md` 缺口 3「外部编辑参考笔记不感知」 |
| **MCP 写工具扩面** | MCP 24 工具读写分级：读自由、写有 .history 备份语义、absorb/agent 对话不开。写面保持最小（正文/参考回写），更多写操作（如批量回填、条目删除）走界面——外部 agent 的写越少，稿子越安全。扩面前先想清楚备份语义是否覆盖。 | `mcp.mjs:1-25`（读写分级红线）；`docs/ACCEPTANCE.md` |
| **故事源大纲双向编辑** | 故事源三形态（大纲/表格/图表）是从 fact 条目＋wiki 章纲**只读算出**的投影；「在大纲里改字→写回 fact 条目」未实现，目前只能手动改条目。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「故事源文本→fact 条目（未实现）」 |
| **fact 增量 PATCH** | fact 写通道是整文件写（revision 自增＋operationId 幂等＋expectedRevision 乐观并发）。条目数大之后整文件写放大，可选做增量 PATCH——但会动自有内核写协议（S2 writeFactFile），属落盘契约变更，须连同互认金样一起评估。 | `src/kernel/fact/factFileStore.mjs`；`docs/kernel-provenance.md` |
| **多轨并行图** | 关系图谱是「笔记＋拆解词条」同图单视图；角色时间线已有泳道图（storySource 事件面积图＋泳道）。「多轨并行」（多条剧情线并行推进的专用视图）未做，等真实创作需求出现再排。 | `public/storySource.mjs`（泳道）；`public/graph.mjs`（单图） |
| **世界书人物单页档案** | 人物信息分散在：参考笔记（自由书写）＋拆解词条（fact 条目详情）。「按人物聚合的单页档案」（一处看全某人设定/事件/关系）未做——与「fact 条目→参考笔记」缺失转换同源，都是 fact↔笔记的单向缺口。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「fact 条目→参考笔记（未实现）」 |
| **任务中心扩任务类型** | jobCenter 是通用后台任务容器（kind: image/vision/enrich/import/…），前端悬浮球轮询。加新任务类型＝纯增量（submitJob 带新 kind），无架构障碍——只是没有想做的任务，先空着。 | `jobCenter.mjs:9-10,57` |

## 【明确不做】——有理由的否决，勿再提议；翻案需作者裁定

| 事项 | 为什么不做 | 对标依据 |
|---|---|---|
| **fsBrowse 目录白名单** | 【已裁定 2026-11-23，作者授权主 agent】不加：白名单与 OS-110/119 的亲验行为冲突（浏览就是直达本机目录树＋记住上次文件夹）；OS-136 的来源防护四层闸已关闭跨站可达性，白名单要挡的威胁已不成立。 | `daemon.mjs`（fs-browse 记忆与端点，`fsBrowse`）；提交 `14a10a1`（OS-110）、`a59fb4b`（OS-119） |
| **插件签名体系** | 本仓没有第三方插件分发场景：货架是本机目录＋内置样例，凭据只存本机。签名解决的是「分发渠道被投毒」，这里没有渠道就没有这个威胁模型——做签名是替不存在的场景付成本。能力约束走 OS-129 白名单（capabilities 声明对齐宿主真实实现）。 | `docs/plan/opendesign-architecture-20261122.md` §5「明确不建议抄的」；`docs/plan/plugin-governance-benchmark-20261122.md` §5 |
| **Next.js（或任何构建链）** | 零 npm 构建依赖是本仓宪法（作者口径「完全本地」）。OpenDesign 用 Next.js 是因为它要做 Web 产品＋桌面壳双轨（141 MB standalone 产物）；OpenStory 单页＋无构建即可覆盖全部功能，换框架只引入构建产物与 SSR 概念，无功能收益。 | `docs/plan/opendesign-architecture-20261122.md` §5 |
| **154 设计系统包的规模** | OpenDesign 的 154 个设计系统是**产品面**（海量主题货架），不是架构面。OpenStory 的口径是：语义令牌单一真源（`public/index.html` `:root`＋`design-system/tokens.css`）＋风格包按需覆盖——令牌机制同源，规模不跟。 | `docs/plan/opendesign-architecture-20261122.md` §5、§附实测出处 |
| **Obsidian 式无白名单 API** | Obsidian 插件可直接 `require('fs')`、读写任意文件、发任意请求，靠社区审核兜底，历史上多次恶意插件事件。OpenStory 走能力白名单：插件 capabilities 声明、宿主按声明加载（OS-129），声明之外没有能力——安全边界前置到加载期，而不是事后审核。 | `docs/plan/plugin-governance-benchmark-20261122.md` §5「不抄第一件」 |

——
维护约定：三档之外无灰区。某条【后续可选】动工时，把它从表里挪进对应批次的交付说明；
做完就删行。【明确不做】的翻案需作者明示，翻案后在行内补记日期与理由。
