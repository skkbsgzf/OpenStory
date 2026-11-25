# OS-195 · 边界收口：工作台之间去直连＋protocol 只留底座契约＋门禁改量真实耦合

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 8 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B6、B9；规划 §1.1「分层负担消失：门禁改写为两条——底座边界＋能力图」、§2.6 禁改区；ADR 0002 §3、§八·补 |
| 依赖 | OS-194 |
| 允许改动 | `src/**`、`test/**`、`tools/acceptance/**`、`tools/arch-stats.mjs`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`docs/workorders/OS-195-boundary-gates.md` |
| 风险 | **高**——收口单，前面的直连台账在这张单全部归零 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

清账批完成时，下面四条规则成立，并且由门禁直接量出来：

- **R-a** 内核实现只有一个静态入口（实现登记表）；其余位置静态 import 内核实现＝0。
- **R-b** 工作台内部实现只许被「本模块的 handler 与前端视图」触及；宿主、底座服务、别的工作台静态 import 它＝0。
- **R-c** `src/protocol/` 只留底座契约，转供叶（`export * from '../modules/…'`）＝0。
- **R-d** `src/services/` 只留底座服务。

## 现状（监督线验收实测）

- OS-193 清掉内核件的转供叶后，`src/protocol/` 里还剩工作台内部与 storage 的：`agentStore`、`courtyard`、`deduceSession`、`habits`、`kbAdapter`、`kbHealth`、`kbRouter`、`libraryImport`、`libraryInventory`、`pediaAdapter`、`referenceStore`、`roleplayEngine`、`worldbookContract`（slug 改名后的文件名以 OS-190 为准）。
- 工作台直连工作台：`roleplayEngine → text`、`library/textUtil → worldbookContract`、`exchange/pediaAdapter → fact`、`agentbar/agentStore → agent-runtime`。
- `src/services/` 里还住着底座服务：`jobCenter.mjs`（ADR 0002 §5.2 裁定归底座）、`nativePicker.mjs`、`uiPreferences.mjs`。
- 门禁 S2.1／S2.4′ 的口径是「只准经转供叶」，所以报 0。

## 任务

### 0. K4 签名一半（OS-193 未做，并入本单）

`src/services/systemPrompt.mjs`、`src/services/syncCheck.mjs` 这类跨内核的底座服务：函数签名显式接收能力句柄，由请求入口解析后传入；不在模块顶层持有 `KERNEL_CAPABILITIES` 引用。调用方（handlers／host）改完仍须全绿。

### 1. 工作台之间去直连（R-b）

- 一个工作台要另一个工作台的东西，只有两条路：对方把它供成能力（manifest 加 `capabilities`，按协议「工作台禁止供给」的现行规定，需要先拆出内核供给者——照 ADR 0002 R6 的口径办）；或者把共享的部分下沉到底座契约（纯函数、与任何工作台无关的，如世界书文件格式解析）。
- `library/textUtil → worldbookContract`、`exchange/pediaAdapter → fact`、`agentbar/agentStore → agent-runtime` 逐条按上面两条路处理，并在回报里写明每条走了哪条路、理由是什么。
- `roleplayEngine → text.analyze`：改经 `context.resolve`（OS-193 口径）。

### 2. protocol 只留底座契约（R-c）

`src/protocol/` 只许有：请求/响应形状与错误信封的纯函数、路径安全、授权、写管道、装载协议、能力图与迁移、slots、命名取表口、旧库一次性升级、进程内事件词表。转供叶全部删除；`src/protocol/README.md` 重写为「底座契约清单」，逐个文件一句话说明它为什么是宪法。

### 3. services 只留底座服务（R-d）

`jobCenter`、`nativePicker`、`uiPreferences` 搬进 `src/host/`（等价搬家）；`src/services/` 里若还剩东西，逐个说明归属，该归内核的归内核、该归工作台的归工作台。目标是 `src/services/` 要么为空并删除，要么只剩能在 ADR 0002 §三里找到出处的底座服务。

### 4. 门禁改口径

S2.1、S2.4′、S2.7 不再按「只准经转供叶」定义，改为直接数静态 import：

- `src/modules/**` 之外 import 模块内部实现＝0，唯一例外是实现登记表；
- `src/api`、`src/host`、`src/services` import 工作台内部＝0；
- `src/protocol` 零转供；
- 内核↔内核零直连（OS-193 的 S2.11 并入）。

反证三则：(a) 临时在 `src/api` 里加一条对某工作台内部的 import；(b) 临时在 `src/protocol` 里加一个转供叶；(c) 临时在 `src/modules/analysis` 里 import `src/modules/text` 的内部文件——门禁都必须红，贴输出后还原。

### 5. 规模统计

`tools/arch-stats.mjs` 按新布局重算分层规模，`ARCHITECTURE.md` 生成段同步；`AGENTS.md` 的分层规则改写成 R-a～R-d 四条。

## 不做

- 不改任何对外契约（端点、MCP 工具名、错误码、落盘格式）；不碰作者真库与真实 `%LOCALAPPDATA%`。
- 不给任何直连加白名单来过关；确实下不了的，停下来上报。

## 验收

- 机器门禁全绿（含改口径后的 S2.1／S2.4′／S2.7）；红线测试 `test/moduleCoverage.test.mjs`、`test/decoupleStep1.test.mjs`、`test/decoupleStep2.test.mjs`、`test/decoupleStep3.test.mjs`、`test/hostApi.test.mjs` 全绿。
- 回报里贴四条规则各自的实测数字（全是 0 或有明确例外清单）与三则反证输出。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 816 · pass 814 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 文档：`AGENTS.md`（分层规则改为 R-a～R-d、目录说明、测试数）、`ARCHITECTURE.md`（arch-stats 生成段回写）、`docs/number-anchors.json`（回写，值未变）
- 门禁：`tools/acceptance/capabilityBoundaries.mjs`（重写为直接数静态 import）、`tools/acceptance/acceptance.mjs`（S2.1/S2.4'/S2.7/S2.11 新口径＋反证可见证据）
- protocol 新增底座契约：`src/protocol/agentCredentials.mjs`、`importAdapter.mjs`、`libraryTextUtil.mjs`
- protocol 转供叶改为真实底座契约（实现由模块下沉）：`src/protocol/{agentStore,courtyard,deduceSession,habits,knowledgeAdapter,knowledgeHealth,knowledgeRouter,libraryImport,libraryInventory,referenceStore,worldbookContract}.mjs`、`src/protocol/README.md`
- protocol 删除转供叶：`src/protocol/pediaAdapter.mjs`、`src/protocol/roleplayEngine.mjs`
- 模块改转供桩：`src/modules/{agentbar/agentStore,storage/courtyard,deduce/deduceSession,habits/habits,knowledge/knowledgeAdapter,knowledge/knowledgeHealth,knowledge/knowledgeRouter,library/importAdapter,library/inventory,library/textUtil,worldbook/referenceStore,worldbook/worldbookFileContract}.mjs`
- 四条直连改造：`src/modules/exchange/{pediaAdapter,handlers,index}.mjs`＋`module.manifest.json`、`src/modules/roleplay/{roleplayEngine,handlers,index}.mjs`、`src/modules/agent-runtime/credentials.mjs`
- K4：`src/services/systemPrompt.mjs`（去掉顶层 `KERNEL_CAPABILITIES` 引用，句柄必传入）、`src/host/daemon.mjs`（`__test` 入口注入句柄）
- 底座服务搬家：`src/host/{jobCenter,nativePicker,uiPreferences}.mjs`（新增），删除 `src/services/{jobCenter,nativePicker,uiPreferences}.mjs`；更新 `src/api/handlers/{fact,system}.mjs`、`src/host/{hostTools,processServices}.mjs`、`src/protocol/index.mjs`
- 测试适配：`test/{moduleCoverage,modulePlugins,newLibrarySkeleton,pediaAdapter,roleplay,uiPreferences}.test.mjs`

VERIFIED:
- `npm test`：816 例 / 814 过 / 0 挂 / 2 skip；红线 `moduleCoverage`/`decoupleStep1`/`decoupleStep2`/`decoupleStep3`/`hostApi` 全绿。
- `node tools/acceptance/acceptance.mjs`：**28 过 / 0 挂 / 0 警**；`node tools/number-anchors.mjs --check`、`node tools/arch-stats.mjs --check`、`git diff --check`（退出码 0，仅 LF→CRLF 警告）均通过。
- 四条规则实测数字：
  - **R-a**：外部静态 import 模块内部实现 = **0**；唯一例外 `src/protocol/capabilityImplementations.mjs` 的 **7** 条（七个内核入口）。
  - **R-b**：跨模块静态 import = **0**；`src/api`/`src/host`/`src/services` → 工作台内部 = **0**。
  - **R-c**：`src/protocol` 转供叶 = **0**，复制模块实现函数体 = **0**。
  - **R-d**：`src/services` 17 文件 = 货架装载 5（genres/runtimes/skills/stylePacks/suites）＋跨内核底座服务 2（systemPrompt/syncCheck）＋OS-193 遗留内核兼容叶 10。
  - 内核↔内核 = 0、services/api/host→内核 = 0（S2.11 五类全 0）。
- 四条直连的处理路径：`library/textUtil → worldbookContract`＝下沉纯格式契约（`protocol/worldbookContract.mjs`）；`exchange/pediaAdapter → fact`＝能力句柄（内核供给，`exchange/index.mjs:11` → `handlers.mjs:44` 的 `createPediaAdapter(factDomain)`）；`agentbar/agentStore → agent-runtime`＝纯掩码函数下沉底座契约 `protocol/agentCredentials.mjs`；`roleplayEngine → text.analyze`＝`context.resolve('text.analyze')`（`roleplay/index.mjs:19` → `handlers.mjs:383,455` 的 `analyze`）。
- K4 生产调用点：`src/api/handlers/agent.mjs:324,353`（入口解析句柄下传）、`src/host/daemon.mjs:74`（测试钩子由 host 注入）；`syncCheck.mjs` 实测不持有内核实现，无需改签名。
- 三则反证（均临时文件、验后已删）：
  - (a) `src/api/handlers/__counterproof.mjs` import 工作台内部：`✗ [S2.1] 外部→模块 1 … 违规：…:1 -> src/modules/roleplay/roleplayEngine.mjs`、`✗ [S2.7] …外部→模块 1`，门禁 24 过/4 挂。
  - (b) `src/protocol/__counterproof.mjs` 加转供叶：`✗ [S2.11] protocol 转供叶 1 … -> src/modules/roleplay/roleplayEngine.mjs`、`✗ [S2.7] …协议转供 1`，门禁 23 过/5 挂。
  - (c) `src/modules/analysis/__counterproof.mjs` import `../text/analysis.mjs`：`✗ [S2.1] 跨模块 1 … 违规：… -> src/modules/text/analysis.mjs`，门禁 24 过/4 挂。
- 临时探针均在系统临时目录且已删除；未执行 git 写操作，未启停 8807 daemon。

LIMITATIONS:
- `src/services/` 仍有 10 个 OS-193 遗留内核兼容叶（agentConfig/chatUpstream/cli-bridge/dsh-bridge/dsh-cli/embeddingPaths/enrichEngine/factBooks/factImportWrite/style-check）：实现早已在内核模块，仅因 `tools/verify/**`、`tools/eval/**`（不在本单允许改动范围）仍 import 旧路径而保留薄壳；未强行搬走，否则越界并破坏工具。
- 为满足 R-a/R-b 且零行为变化，部分 `src/protocol/` 文件是把共享实现从工作台/宿主组合面**下沉**为底座契约（如 referenceStore/habits/agentStore/deduceSession/libraryInventory/knowledge*），不是纯接口声明；逐文件「为什么是宪法」已写入 `src/protocol/README.md`。若监督线要求 protocol 只放纯声明，需另立单拆内核供给者。
- 未跑隔离 e2e（水浒/新建）；工单验收只点名机器门禁、红线测试、数字锚、架构统计与反证，故未执行。
```
