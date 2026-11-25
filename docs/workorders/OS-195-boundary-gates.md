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
