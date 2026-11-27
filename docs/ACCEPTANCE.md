# OpenStory 验收线（OS-67 起）

> 每个大修改落地前的四步验收。机械门禁 `tools/acceptance/acceptance.mjs`（29 检查，
> OS-140 起含 S0 布局宪法，OS-169 起含 S1.6 测试环境健壮性，OS-170 起含 S2.8 数字锚，
> OS-172 起含 S2.9 四名一致与 S2.10 谱系名/作者身份，退出码 0=全绿），配套 `.ua/` 知识图谱、Rea 证据口径、OpenDesign UX 对标。

## 五条交付标准 → 检查映射

| 标准 | 检查 | 口径 |
|---|---|---|
| S0 布局 | S0.1–S0.2 | 布局宪法（OS-159）：根目录白名单（零散落 `.mjs`），启动入口直跑 `src/host/{daemon,mcp}.mjs`，自持模块全部在 `src/` 六目录（host/api/protocol/kernel/modules/services）· 架构文档数字与实测一致（OS-150：ARCHITECTURE.md 生成段逐字比对 `tools/arch-stats.mjs`，改了文件结构就跑 `npm run arch:stats` 回写，人不再手填） |
| S1 Agentic | S1.1–S1.6 | MCP 工具覆盖四模块（读+写，工具名取真实 `MCP_TOOL_NAMES`）· docs/mcp 完整工具名双向同步（OS-219：幽灵工具/漏文档工具都红；OVERVIEW 若声明工具数必须严格相等，无数字也红）· skills/ 31 包完整 · dsh-cli 运行时 · 多 CLI 派发器 · 测试不依赖本机环境（OS-169：`test/**` 本机绝对路径零容忍，允许清单为空；本机无依赖时显式 skip 并注明守卫理由） |
| S2 可插拔 | S2.1–S2.10 | 能力路由边界（模块只经协议/能力句柄；显式兼容转供叶不得复制实现）· 前端模块隔离 · 契约驱动（endpointFor + validateResponse）· 底座边界（S2.4'：kernel 不反向依赖、host 不私接模块/前端、无 core/vendor 回潮、base.* 五项句柄齐全）· 来源防护闸常绿 · 命名真源表一致 · 豁免表无腐化 · 能力归属（S2.7：stage C、kernel 零端点/UI、workbench entry/requires/slots、端点唯一归属、能力图与独立进程 activate/贡献校验）· 数字锚一致（S2.8）· 四名一致（S2.9）· 产品谱系名与作者身份（S2.10） |
| S3 前端一致性 | S3.1–S3.3 | 裸色值零容忍（:root 令牌单一真源）· 浮层宪法（OS-48 不挤压正文）· 组件约定类齐备 |
| S4 UX 跳转层级 | S4.1–S4.3 | 核心页签顶栏可达（注册表 core:true 条目逐条验 label/render 注册名/scope；渲染块先剥注释，注释不许冒充已注册，OS-150a）· 关闭按钮两级约定（rm-x/page-close）· docs/UX-STRUCTURE.md 清单在 |
| CI 合入门禁 | `.github/workflows/ci.yml` | Node 24；`gates`＝`npm test` 两轮＋验收门禁＋架构统计＋隔离全栈 E2E；`browser-smoke`＝完整页面矩阵＋报告完整性校验；失败留日志、manifest 与截图产物 |

## 落地前四步

```bash
# ① 单测门禁（1017 例，OS-206～209 起含页面矩阵、MCP 隔离链路与本机运行期契约）
node .zcode/run-gate.mjs

# ② 交付标准门禁（S0–S4，Rea 式证据落盘）
node tools/acceptance/acceptance.mjs --json tools/acceptance/out/report-<日期>.json

# ③ 知识图谱增量（Understand-Anything，改了哪些文件就重析哪些）
#    Zcode 会话里直接说「跑 understand 增量」或 /understand（skill 已装在 ~/.zcode/skills/）
#    → .ua/knowledge-graph.json 更新；「跑 understand-diff」看改动影响面

# ④ UX 视觉对标（OpenDesign 基线）
#    前端批次按记忆里的截图规矩：改完给作者截图讲场景；对照 design-system/DESIGN.md 令牌
#    与 docs/UX-STRUCTURE.md 层级清单逐条过。
```

①② 是硬门禁（挂了不合入）；③④ 是理解面与视觉面（图谱陈旧 = 影响面分析失真）。

**CI 门槛＝三层隔离门禁（OS-206～210）。** `gates` job 跑两轮单测、验收与架构核对，再跑
`tools/verify/verify-os172-e2e.mjs`；`browser-smoke` job 在 Ubuntu 安装 Chromium，跑完整页面矩阵。
两条 E2E 都使用临时 daemon、临时库、临时 `LOCALAPPDATA` 与假上游，**不连接 8807、不读作者真库**。
浏览器报告再经 `verify-page-report.mjs` 校验：页面集合必须等于矩阵，无 fail/manual/skip，截图为真实
非空 PNG，无 console/pageerror、非预期 HTTP 错误或横向溢出；失败时日志、manifest 与截图作为 artifact 保留。

本地等价命令：

```bash
node .zcode/run-gate.mjs
node tools/acceptance/acceptance.mjs
node tools/arch-stats.mjs --check
node tools/verify/verify-ci-workflow.mjs
node tools/verify/verify-os172-e2e.mjs
node tools/verify/page-browser-smoke.mjs --out /tmp/openstory-page-smoke
node tools/verify/verify-page-report.mjs /tmp/openstory-page-smoke
```

测试纪律（OS-169）：测试不许依赖本机环境——一律临时 `LOCALAPPDATA` 夹具、不读真实用户目录、
不靠本机恰好装了某个 CLI 或下载过某个模型；环境不齐就显式 skip 并写明守卫理由，不许靠本机环境「假绿」。

数字锚（OS-170）：机器可读真源是 `docs/number-anchors.json`，由 `node tools/number-anchors.mjs`
真实复跑测试后回写；S2.8 同时核对文档、JSON 与实测。`app.js` 行数按物理行统计：CRLF／LF 归一，
空行与注释计入，末尾换行不额外计一行；当前上限 10,500 行，保留 11,886 初始锚，只许下调不许上调。

## 三件套是什么、怎么用

### Understand-Anything（代码知识图谱）
- 安装：`C:/Users/Administrator/.understand-anything/repo`（MIT，Egonex-AI；pnpm 构建的
  `@understand-anything/core` ＋ web-tree-sitter wasm 解析）。9 个 skill 以 junction 链入
  `~/.zcode/skills/understand*`，Zcode 全会话可用。
- 产物：`D:/OpenStory/.ua/knowledge-graph.json`（节点=文件/函数/类/文档，边=imports/calls/
  contains/tested_by/documents…，带分层 layers 与导览 tour）。
- 用法：`/understand`（增量）、`/understand-diff`（改动影响面）、`/understand-explain <file>`、
  `/understand-chat <问题>`、`/understand-onboard`（新人导览）、`/understand-dashboard`（可视化）。
- 注意：`core/`、`vendor/` 已于 OS-157 整体退役，不再需要 `.ua/.understandignore` 排除；内核实现在 `src/kernel/`。

### Rea 证据口径
- 样例：`D:/refs/rea-out/`（pinax/siyuan 的 records/evidence 结构化分析）。
- 本仓落法：acceptance.mjs 每条检查带 `file:line` 证据；报告 JSON
  （schema `openstory.acceptance/v1`）即 Rea 式 records——结论必须可回溯到源码位置。

### OpenDesign UX 对标
- 对标源：`D:/OpenDesign/resources/open-design/design-systems/`（151 个设计系统包，
  每个 = manifest.json + DESIGN.md + tokens.css，repo guard 强制令牌一致）。
- 本仓落法：`design-system/`（manifest.json + tokens.css + DESIGN.md）照同一契约打包；
  令牌改名对照：OD `--surface/--fg/--muted/--accent` ≈ 本仓 `--surface-card/--ink/--muted/--accent`。
- 体验对标：卡片堆叠/浮层/居中宪法在 `docs/UX-STRUCTURE.md`，视觉验收走截图规矩。

## 白名单与豁免（改架构时同步这里）

- S2.1 能力路由：`src/modules/**` 只准 node 内置、`src/protocol/**`、本模块与点名的套件资源；
  API/services/host/protocol 直连模块仅限 `tools/acceptance/capabilityBoundaries.mjs` 的显式转供叶。
  转供叶只许 re-export/绑定，较大函数体与目标实现重复即拒绝；动态 import 与静态 import 都扫描。
- S2.4' 底座边界：`src/kernel/**` 不得反向 import 协议/业务模块；host 只允许点名的能力绑定/院子转供；
  `src/**` 与仓根不得出现 `core/`/`vendor/` 路径说明符；`writeFileAtomic` 不得在 `src/kernel/` 外复制。
  `base.process/base.loader/base.contract/base.write/base.naming` 五项句柄必须存在。
- S2.7 能力归属：21 份内置 manifest＝7 kernel＋12 workbench＋2 宿主组合面；生产 stage C。
  kernel 的 endpoints/pages/slots/settings/settingsHint/settingsJump 必须为空，workbench 必须有 entry/requires/slots；
  端点归属唯一，能力图无错误，独立进程真实 activate 并校验 capabilities/handlers/pages/settingsConsumers。
- S4.2 关闭家族：模块卡 `rm-x`，整页 `page-close`。
- S3.1 裸色值豁免：无（画布绘图用 getComputedStyle 现读令牌，见 public/graph.mjs）。

## 已知边界

- UA 管线首次全量分析花了约 12 个 file-analyzer 批次（150 文件）；此后增量只重析变更文件。
- S1.2 文档同步检查（OS-219）：工具名真源是 `src/host/mcp.mjs` 导出的
  `MCP_TOOL_NAMES`（与 stdio `tools/list` 同源），不正则数源码；纯函数入口为
  `tools/acceptance/mcpDocsAudit.mjs:auditMcpDocs`，反例在 `test/mcpDocsAudit.test.mjs`。
  `docs/mcp/**` 中每个完整 `openstory_*` 名称都必须存在，每个真实工具也必须在任一文档出现；
  OVERVIEW 的「N 个工具」声明必须严格相等，无数字、±1 或旧 ±2 容差均不放行。
- 定向施工只跑新增单测与 acceptance 时，可传 `--skip-full-tests`：S2.8 只即时核对静态数字锚，
  全量测试明确标为未跑并将该项记为 WARN，不能冒充完整验收通过；正式 CI/全量验收不传此开关，
  仍执行 `node tools/number-anchors.mjs --check` 的真实全量复跑。
- OpenDesign 是安装版（无源码），对标以设计令牌契约 + 界面模式为准，不做二进制逆向。
