# OpenStory 验收线（OS-67 起）

> 每个大修改落地前的四步验收。机械门禁 `tools/acceptance/acceptance.mjs`（17 检查，
> OS-140 起含 S0 布局宪法，退出码 0=全绿），配套 `.ua/` 知识图谱、Rea 证据口径、OpenDesign UX 对标。

## 五条交付标准 → 检查映射

| 标准 | 检查 | 口径 |
|---|---|---|
| S0 布局 | S0.1 | 布局宪法（OS-140）：仓根 `.mjs` 恰好两个入口垫片 daemon.mjs/mcp.mjs，自持模块全部在 `src/` 六目录（host/api/protocol/kernel/modules/services） |
| S1 Agentic | S1.1–S1.5 | MCP 工具覆盖五模块（读+写）· mcp/skills 文档同步 · skills/ 30 包完整 · dsh-cli 运行时 · 多 CLI 派发器 |
| S2 可插拔 | S2.1–S2.5 | 模块间零 import（协议层 contracts/changelog/versionGate/plugins/pinaxAdapter 除外）· 前端模块隔离（md.mjs 渲染协议除外）· 契约驱动（endpointFor + validateResponse）· 内核唯一进口（src/ 模块＋垫片中仅 src/kernel/pinaxAdapter.mjs 可引 core/**，OS-125）· 来源防护闸常绿（OS-136：`test/originGuard.test.mjs` 钉死 Host/Origin/Sec-Fetch-Site 三道闸＋强制 JSON content-type，daemon 只服务本机回环，任意网页写不进）· 命名真源表一致（OS-148：页签层与 changelog 模块名都只从 `public/views/registry.mjs` 的 `NAMING_TABLE` 取） |
| S3 前端一致性 | S3.1–S3.3 | 裸色值零容忍（:root 令牌单一真源）· 浮层宪法（OS-48 不挤压正文）· 组件约定类齐备 |
| S4 UX 跳转层级 | S4.1–S4.3 | 核心页签顶栏可达 · 关闭按钮两级约定（rm-x/page-close）· docs/UX-STRUCTURE.md 清单在 |

## 落地前四步

```bash
# ① 单测门禁（523 例，OS-148 起含 test/naming.test.mjs 命名单一真源 5 例）
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

## 三件套是什么、怎么用

### Understand-Anything（代码知识图谱）
- 安装：`C:/Users/Administrator/.understand-anything/repo`（MIT，Egonex-AI；pnpm 构建的
  `@understand-anything/core` ＋ web-tree-sitter wasm 解析）。9 个 skill 以 junction 链入
  `~/.zcode/skills/understand*`，Zcode 全会话可用。
- 产物：`D:/OpenStory/.ua/knowledge-graph.json`（节点=文件/函数/类/文档，边=imports/calls/
  contains/tested_by/documents…，带分层 layers 与导览 tour）。
- 用法：`/understand`（增量）、`/understand-diff`（改动影响面）、`/understand-explain <file>`、
  `/understand-chat <问题>`、`/understand-onboard`（新人导览）、`/understand-dashboard`（可视化）。
- 注意：`core/`（vendor 内核）在 `.ua/.understandignore` 排除——它不是 OpenStory 自身架构。

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

- S2.1 白名单：`src/modules/deduce/deduceSession.mjs → src/modules/deduce/deduceEngine.mjs`（会话容器引引擎＝内核依赖）；
  `core/**` vendor 内核不算模块；`src/kernel/pinaxAdapter.mjs` 是内核唯一进口＝能力协议面（OS-125）。
- S2.4 唯一进口：src/ 模块＋仓根两个垫片中只有 `src/kernel/pinaxAdapter.mjs` 允许 import `core/**`（静态 `from` 与动态
  `import()` 都算；OS-140 起扫描面＝`src/` 树全部 `.mjs` ＋垫片）；内核能力只经它的五组出口（factStore/deduce/enrich/projectMeta/projectImport）。
  `vendor/contracts`（@pinax/core 收编后的世界书契约，OS-132）与 `test/*.test.mjs` 不在扫描范围。
- S4.2 关闭家族：模块卡 `rm-x`，整页 `page-close`。
- S3.1 裸色值豁免：无（画布绘图用 getComputedStyle 现读令牌，见 public/graph.mjs）。

## 已知边界

- UA 管线首次全量分析花了约 12 个 file-analyzer 批次（150 文件）；此后增量只重析变更文件。
- S1.2 文档同步检查是启发式（OVERVIEW 无硬编码工具数即过）；工具清单核对以
  `node -e "…matchAll(/name: '(openstory_[a-z_]+)'/g)"` 实测为准。
- OpenDesign 是安装版（无源码），对标以设计令牌契约 + 界面模式为准，不做二进制逆向。
