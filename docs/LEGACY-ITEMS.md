# 遗留台账（截至 D 批收口 · 全批收口现状）

> OS-123→133 解耦与治理批次建立本台账（2026-11-23），OS-168 按现状总审（2026-11-24），OS-172 拆除互认并正名（2026-11-25），D 批收口（2026-11-25）。
> 这份文档是「没做完/不做」事项的**唯一台账**：凡不在四档之内的事，等于「已做完且有测试与门禁护栏」。
> 新事项先入档再动工；做完就删行。OS-157～168 全部有测试与门禁护栏，不入档。
> 四档条目数：已裁定 6／作者动作 1／后续可选 11／明确不做 5。

## 【已裁定】——作者裁定固化，细节以 ADR 为准（裁定本身不是待办）

| 裁定 | 日期 | 去向 |
|---|---|---|
| **G7 数据源归一：统一成 fact（合并路线）**——fact.data（v3/legacy v2）是唯一事实 schema；pedia/v1（NovelPedia）视为同源同质；OpenStory↔NovelPedia 导入导出一律走 fact.data/v3。 | 【已裁定 2026-11-23：统一成 fact】 | `docs/adr/0001-fact-schema-unification.md`。OS-162 已落地薄适配器＋导入/导出端点（共用 fact 写通道，非第二套写逻辑）；唯一仍开放项＝**拿 NovelPedia 真实数据跑一次导出→导入回环复验**，见【作者动作】 |
| **模块闸库路径（OS-144 遗留，OS-165 审结）**——曾担心停用时拿不到库根、退回 daemon 默认库或清单第一条。 | 【已审结 2026-11-24：无残留】 | 41 个模块独占端点的契约 `request` **全部带 root**（脚本审计＋`test/moduleCoverage.test.mjs` 钉死），daemon 的模块闸优先取已授权的请求 root；MCP 分析工具不显式给 root 就完全不判定，绝不回落清单；`moduleHooks` 均由调用方传 root。`daemon.moduleGateRoot` 的「默认库＞第一条」只是无库上下文的老调用兜底，对独占端点不可达。无待办，不入档 |
| **旧院路径冻结（OS-166；OS-189 收口）**——品牌分家后不再有第二处路径拼接，旧院也不再参与运行。 | 【已裁定 2026-11-24：不删不改；2026-11-25：克隆整体退役】 | 新院 `%LOCALAPPDATA%/OpenStory/` 由 `src/protocol/courtyard.mjs`（宿主门面 `src/host/courtyard.mjs`）唯一解析；`ensureCourtyard` 只负责「新院不存在就建」，旧院与其它本机目录不读、不写、不删，已有标记文件不读不删。反向守卫见 `test/courtyard.test.mjs`。无待办，不入档 |
| **库清单分家（OS-167；OS-172 收口）**——`next-preferences.json` 不再是 OpenStory 的 root 授权来源。 | 【已裁定 2026-11-24：自持清单；2026-11-25：Pinax 导入退役】 | 新院 `libraries.json` 是自持清单（`{schemaVersion,libraries:[{path,name,addedAt,source}]}`，`source=openstory\|imported`）；`OPENSTORY_PREFERENCES` 是唯一路径环境变量，旧 `PINAX_OS_PREFERENCES` 不回落。Pinax 清单扫描/勾选导入端点已退役，产品不读旧清单、不写回旧清单；库身份靠 `.openstory/project.json`，不靠任何本机清单。无待办，不入档 |
| **互认已拆除、目录已正名（OS-172）**——运行态与命名归 OpenStory，旧名不再表示当前格式。 | 【作者确认 2026-11-24：一次性迁移，不双读】 | 运行态唯一为 `.openstory/`；`参考/→世界书/`、`拆解/→故事源/`、`推演/→扮演/`、`导出/→导入导出/`，页面名为 `产物`；项目为 `openstory-project@4`、carrier 为 `openstory.carrier.*`、wiki 为 `openstory-wiki-derived@2`、临时前缀为 `.openstory-tmp-`。旧库先备份到 `.history/upgrade-<时间戳>/`，成功后旧目录改名 `.retired-<时间戳>` 留档并写升级标记，失败回滚。明确推翻 OS-48／OS-50 的目录名冻结与第二批 G8b 的 `参考/` 冻结；不保留 `.pinax/` 与 `.openstory/` 长期双读，也不再用 Pinax 桌面端打开验证。无待办，不入档 |
| **与 Pinax 的运行时关联已全部退役（OS-189）**——产品代码里旧名只剩一次性升级与出处声明两类。 | 【作者裁定 2026-11-25：必须全部退役】 | 本单删除：首启旧院克隆（`LEGACY_COURTYARD_DIR`／`MIGRATION_MARKER`／`MIGRATION_SPEC`／`legacyCourtyardPath` 及拷贝、标记、日志分支）；库清单 `recentProjects` 兼容读、`legacy` 字段、`'imported-pinax'`、`LEGACY_MANIFEST_FILE` 与按文件名写保护特判（改为通用内容形状校验）；导入适配器旧目录名直判（改调 `libraryUpgrade.isLegacyLibraryRoot`，错误提示不露旧名）；运行时旧临时前缀回收（`LEGACY_TMP_PREFIX` 分支，残留归 OS-188a 升级归档）；`LICENSE` 指向已不存在目录的 vendor 表述；`skills/README.md` 与 `public/scriptFact.mjs` 的过时指引；审计脚本的旧 ui-state 路径；谱系门禁的 8 个整文件豁免。反向守卫与两则反证见 `test/courtyard.test.mjs`、`test/libraryManifest.test.mjs`、`test/decoupleStep1.test.mjs`、`test/kernelPlumber.test.mjs`、`test/os172Naming.test.mjs`。无待办，不入档 |

## 【作者动作】——需要作者在真实环境验证一次

| 事项 | 现状与依据 | 风险 |
|---|---|---|
| **NovelPedia 真实数据复验（OS-162 写入器落地后新开放）** | `src/modules/exchange/pediaAdapter.mjs` 与 `/api/exchange/import|export` 已落地，字段映射按 ADR 0001 附录 A 钉死（三层样本、id 不变、style 单列、丢失字段清单），测试用合成夹具。真实 NovelPedia 书库里可能还有附录没覆盖的边缘字段/编码，需要作者拿一本真书跑一次「导出→再导入」回环。 | 中——合成样本过不代表真实数据过；回环只读一次，不阻塞日常写作。 |

## 【后续可选】——有真实价值、无明确排期；动工前先在此登记

| 事项 | 现状 | 依据 |
|---|---|---|
| **AG-UI 对接第三方消费者** | AG-UI 协议出口已接入：`agentEvents.mjs` 内部事件模型是 canonical（唯一真源），daemon SSE 帧已是它的投影（OS-128/131）。但至今**没有任何第三方客户端**消费 AG-UI 帧——协议出口在等一个真实消费者，在此之前不扩面。 | `agentEvents.mjs:1-20`（定位注释「未来第三方客户端…」） |
| **RAG 导出端点（OS-165 新开放）** | ADR 0001 §五已落地 `/api/exchange/export`（pedia/v1 与 JSONL 两个出向格式），但面向 RAG 的专用导出仍标「规划」——它的目标消费者、切块粒度与检索契约都还没定，先不做空壳端点。 | `docs/adr/0001-fact-schema-unification.md` §五；`src/api/contracts/exchange.mjs` |
| **自动化 UI 测试（OS-165 新开放）** | 当前护栏是 Node 测试（812 例）＋验收门禁（27 项）＋纯视图金样；浏览器侧有人工冒烟与 OS-172 的 675/420 窄屏验收。没有 Playwright 一类的端到端点击测试——引入它要带浏览器依赖与构建链，与「零构建依赖」宪法冲突，等真实回归痛点出现再评估。 | `test/*.test.mjs`；`tools/acceptance/acceptance.mjs`；OS-157 验收记录 |
| **fs.watch 常驻监听** | 外部编辑（VSCode 改文件）不感知：世界书索引只有本页编辑后 1.6s 防抖重扫。常驻 fs.watch 是候选修法，但会带来监听器生命周期与跨平台噪声问题，未做——现状「手动刷新可用」。 | `docs/AUDIT-SYNC.md` 缺口 3（世界书索引） |
| **MCP 写工具扩面** | MCP 24 工具读写分级：读自由、写有 .history 备份语义、absorb/agent 对话不开。写面保持最小（正文/世界书回写），更多写操作（如批量回填、条目删除）走界面——外部 agent 的写越少，稿子越安全。扩面前先想清楚备份语义是否覆盖。 | `mcp.mjs:1-25`（读写分级红线）；`docs/ACCEPTANCE.md` |
| **故事源大纲双向编辑** | 故事源三形态（大纲/表格/图表）是从 fact 条目＋wiki 章纲**只读算出**的投影；「在大纲里改字→写回 fact 条目」未实现，目前只能手动改条目。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「故事源文本→fact 条目（未实现）」 |
| **fact 增量 PATCH** | fact 写通道是整文件写（revision 自增＋operationId 幂等＋expectedRevision 乐观并发）。条目数大之后整文件写放大，可选做增量 PATCH——但会动自有内核写协议（S2 writeFactFile），属落盘契约变更，须连同迁移金样一起评估。 | `src/kernel/fact` 已退役为运行位置；当前实现位于 `src/modules/fact/fact/factFileStore.mjs`，由 `fact.store@3` 能力供给；`docs/kernel-provenance.md` |
| **多轨并行图** | 关系图谱是「世界书笔记＋故事源词条」同图单视图；角色时间线已有泳道图（storySource 事件面积图＋泳道）。「多轨并行」（多条剧情线并行推进的专用视图）未做，等真实创作需求出现再排。 | `public/storySource.mjs`（泳道）；`public/graph.mjs`（单图） |
| **世界书人物单页档案** | 人物信息分散在：世界书笔记（自由书写）＋故事源词条（fact 条目详情）。「按人物聚合的单页档案」（一处看全某人设定/事件/关系）未做——与「fact 条目→世界书笔记」缺失转换同源，都是 fact↔笔记的单向缺口。 | `docs/AUDIT-ARTIFACTS.md` 缺失转换「fact 条目→世界书笔记（未实现）」 |
| **第三方可执行模块动态装载（D4 裁定暂缓）** | 三类 manifest 与能力图已就位，suite 已无代码化；kernel/workbench 的可执行代码仍只来自仓内受审源码。开门需同时满足 G1–G5（本机根显式授权、快照与激活缓存含代码摘要、运行期 import 边界、候选快照原子切换、覆盖回退/迁移安全阀联调），当前均未满足。 | `docs/adr/0003-dynamic-loading.md`；`src/protocol/slots.mjs`；`src/services/suites.mjs` |
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
维护约定：四档之外无灰区。某条【后续可选】动工时，把它从表里挪进对应批次的交付说明；
做完就删行。【明确不做】的翻案需作者明示，翻案后在行内补记日期与理由。
