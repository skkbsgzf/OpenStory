# MCP 构建、项目升级与独立知识库批（OS-211～231）

> 作者 2026-11-26 裁定，优先级以作者原话为准：
> 1. 先搞定 MCP 与 sample 更新；旧手搓《水浒传》不能验证新架构。
> 2. 建立通用 `build-project` 与 `update-project` skill，解决项目初始化、版本冲突、迁移与恢复指引。
> 3. 知识库是独立插件，世界书式 wiki 呈现，但属于跨项目储备知识；开源、可加载/切换/定制，首版直接接 HyperGraphRAG。
>
> 作者已确认顺序：**构建 → 升级 → 知识库**。执行方式：动态 workflow；`dsv4flash` 与 `hy4flash` 并行交替施工，对方模型独立评审；监督线验收并提交。不 push、不 tag。

## 1. 为什么现在做

- 当前 24 个 MCP 工具没有建库、套件治理、exchange、fact 导入、升级与 KB search；`openstory_libraries` 只列库。
- `samples/水浒传` 的 7 条 fact 静态核对不满足当前 v3 校验；主档 revision 5，wiki 派生版本 4，`syncCheck` 只比较时间戳，漏检。
- 通用 `/api/chapter` 可写 `故事源/*.json`，绕过 fact schema/revision/operationId；世界书 MCP 写入也借用该端点，模块闸归属不正确。
- `factEntriesImport` 是整份替换；`writeFactFile` 的 `patch.entries` 未逐条调用 `validateFactEntry`。
- skills 只有四类，`operate` 不存在；31 个内置技能可载，另有 2 个套件捆绑技能；humanizer 实际被归为 craft。
- 旧库升级与 capability migration 已有备份/journal/回滚，但缺只读诊断、dry-run、确认执行与专用状态接口。
- 知识库四端点只做配置/健康；检索散在 Agent hook 的 WeKnora 直连路径，没有统一 API/MCP/wiki 消费。

## 2. 三阶段与工单

### 阶段 A · MCP 构建闭环与《水浒传》重建

| 序 | 工单 | 内容 | 依赖 |
|---|---|---|---|
| 1 | OS-211 | 写边界与 fact 完整性：章节载体目录限制、世界书专用写端点、patch.entries 校验、fact/wiki revision、syncCheck | 无 |
| 2 | OS-212 | operate skill 协议、工具白名单/确认级别、humanizer 分类、货架一致性 | 无 |
| 3 | OS-213 | MCP 构建原语 I：建库/诊断/导入/主载体、套件、fact books/entries/import、exchange | 211 |
| 4 | OS-214 | 剧本↔fact 服务端互转；多局/turn/archive/export/promote/pending/branch/素材/推演生图 | 211 |
| 5 | OS-215 | MCP 构建原语 II：剧本互转、多局/扮演、rename、素材/生图包装 | 213、214 |
| 6 | OS-216 | 官方 build-project skill 与工具速查表 | 212、213、215 |
| 7 | OS-217 | MCP-only 水浒 clean-room 构建器、调用审计与语义 digest E2E | 216 |
| 8 | OS-218 | 新 samples/水浒传 落盘、逐工作台验收、README/DEMO/数字锚 | 217 |
| 9 | OS-219 | tools/list 文档/schema 门禁、operate 白名单、构建链 CI、旧文档清理 | 218 |

### 阶段 B · update-project 与版本冲突安全链

| 序 | 工单 | 内容 | 依赖 |
|---|---|---|---|
| 10 | OS-220 | 只读升级诊断与计划核心：文件级操作、冲突、skipped、备份范围、风险、摘要哈希 | 无 |
| 11 | OS-221 | 专用迁移状态与备份产品接口：journal、dataVersions、dataAhead、备份清单/校验 | 220 |
| 12 | OS-222 | diagnose/plan/apply/status/backup verify 与 MCP 工具；planId 绑定文件/迁移器摘要；confirm:true | 221 |
| 13 | OS-223 | 官方 update-project skill；诊断→计划→作者确认→执行→核对；禁止 shell/fs 改稿 | 222 |
| 14 | OS-224 | 迁移 E2E、DATA_VERSION_AHEAD、失败回滚、plan 漂移、文档/CI/数字锚 | 223 |

### 阶段 C · 独立知识库插件与 HyperGraphRAG

| 序 | 工单 | 内容 | 依赖 |
|---|---|---|---|
| 15 | OS-225 | 中性 wiki 呈现层抽取；世界书真实改用公共层，保留作品策略 | 无 |
| 16 | OS-226 | 系统级多知识库清单/文档/定制/hash/revision/active/enabled；开源种子知识包 | 225 |
| 17 | OS-227 | 独立知识库工作台：wiki、搜索、图谱、登记确认、启停/切换、定制、索引状态 | 226 |
| 18 | OS-228 | HyperGraphRAG kernel 与 stdio sidecar：health/insert/query/read/index.status、超时/崩溃/stale | 226 |
| 19 | OS-229 | API/MCP/Agent 共用 KnowledgeSearchService；MCP 首版 list/search/read；WeKnora 兼容 | 227、228 |
| 20 | OS-230 | 真实 HyperGraphRAG 固定版本安装、四题材黄金语料质量/延迟/来源验收 | 229 |
| 21 | OS-231 | 知识库浏览器/API/MCP E2E、页面矩阵/420px、三通道同源、CI/文档/数字锚 | 230 |

## 3. Workflow 波次

> 执行时以**实际文件面和依赖**为准：同文件或直接依赖的任务串行；只有文件面真正不重叠的任务并行。下表是模型交替顺序，不代表同波两项一定同时开工。

| 顺序 | dsv4flash | hy4flash | 实际并发 |
|---|---|---|---|
| A1 | OS-211 | OS-212 | 串行（共享 `mcp.mjs`） |
| A2 | OS-213 | OS-214 | 并行（MCP 包装 vs 服务端原语，文件面隔离） |
| A3 | OS-215 | OS-216 | 串行（216 依赖 215） |
| A4 | OS-217 | OS-218 | 串行（218 依赖 217） |
| A5 | OS-219 | — | 单工单 |
| B1 | OS-220 | OS-221 | 串行（221 依赖 220） |
| B2 | OS-222 | OS-223 | 串行（223 依赖 222） |
| B3 | OS-224 | — | 单工单 |
| C1 | OS-225 | OS-226 | 串行（226 依赖 225） |
| C2 | OS-227 | OS-228 | 并行（工作台 vs runtime，文件面隔离） |
| C3 | OS-229 | OS-230 | 串行（230 依赖 229） |
| C4 | — | OS-231 | 单工单 |

每张单由对方模型评审；P0/P1 最多返工两轮，仍不通过则阻塞上报。

## 4. 执行合同

1. 施工 agent 读工单、`AGENTS.md`、`COMMON-RULES.md`；只在 allow 范围落代码。
2. 不执行 git 写操作、不 push/tag、不碰 `.zcode/`、不连/不重启 8807；只用临时库、临时 `LOCALAPPDATA`、port:0 daemon。
3. 零新增 npm 依赖、零构建；`package.json` 版本/依赖不动；`public/app.js` 只减不增，新渲染进 views/modules。
4. 既有端点与 MCP 工具名不改，只新增；写操作遵守备份、授权、模块闸与错误信封。
5. 每波跑全量 `npm test`；数字锚由指定 agent 单独维护后再跑全量。阶段末跑验收、arch、number anchors、CI 结构与对应 E2E；阶段 C 跑完整浏览器矩阵。
6. Workflow 只施工、评审、跑门禁、产出报告，不提交；监督线独立复核后提交。

## 5. 出口条件

1. 空目录仅经 MCP＋build-project 可重建《水浒传》；内容写入调用审计无直写旁路；新样本 fact 全合法、fact/wiki revision 一致。
2. 建库、套件、fact、exchange、剧本、多局、扮演、导出均有 MCP 原语与成功/负向测试。
3. update-project 预览零写入；confirm:false、过期 plan、文件/迁移器摘要漂移拒绝；失败回滚与 rolledBack:false 如实报告。
4. 知识库独立启停；世界书只复用中性 wiki 呈现层；HyperGraphRAG 首版真实可用；API/MCP/Agent 同查询同源。
5. 凭据不泄漏，stale/down 不伪装空结果；所有新增页面有真实 Chromium DOM/布局/状态断言与截图。
6. 全量单测、29+ 验收、arch、数字锚、CI 结构、对应 E2E、完整 browser smoke 全绿；不 push、不 tag。
