# OS-199 · 文档与门禁收口：作者要过目的东西与实现一致

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 12 张（收口）；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §二 A3；作者验收意见 S2（文档数字漂移） |
| 依赖 | OS-188a～OS-198 全部验收 |
| 允许改动 | `docs/**`、`README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`LICENSE`（仅当 OS-189 的核对结论需要修正事实陈述）、`tools/number-anchors.mjs`、`tools/acceptance/acceptance.mjs`、`test/numberAnchors.test.mjs`、`test/finalAudit.test.mjs`、`docs/number-anchors.json`、`docs/workorders/OS-199-docs-settle.md` |
| 风险 | 低——只动文档与数字锚门禁 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

作者坐下来过目时，看到的每一句话都与仓里的实现一致；以后再漂移，门禁直接红。**文档里的数字不许手写**——能由脚本得到的一律走数字锚。

## 任务

### 1. ADR 0002（底座宪法）

- §二两张表与 21 份 manifest 逐行一致（正名、slug、页面 id、目录、日志模块名、能力、requires）。
- §四 装载序 B0–B7 写成实际实现的样子，逐级注明落点（`文件:函数`）。
- §五 四个开放问题写成最终结论（含 naming 的归属——按 OS-198 之后的实际写）。
- §六 R1–R14 逐条写明落到了哪张工单。
- §八、§八·补 两段历史实施记录合并成一节「实施沿革」，开头写明「现状以上文为准」。
- §九 D1–D8 每一条标「已实施」并给证据（工单号或测试名）；确有未实施的写明原因。
- §十 补记作者 2026-11-25 两条裁定（D 批遗留不接受妥协；Pinax 业务全部退役）。

### 2. ADR 0003（动态装载）

状态改为「已开放」；§三 G1–G5 逐门写验收证据（守护测试名）；§五 遗留按实际更新。

### 3. 协议文档

`docs/protocol/module-manifest-2.md` 全文逐节对照实现核一遍：字段矩阵、能力协议、覆盖与迁移规则、slot、套件投影来源、本机模块的 import 边界与 `context`。

### 4. 三份入口文档

- `README.md`：仓结构表、数据位置段、货架段、新增「本机模块」一节；致谢段与出处声明保留。
- `AGENTS.md`：分层规则（OS-195 的 R-a～R-d）、与 Pinax 的边界、本机模块的信任模型、落盘表。
- `ARCHITECTURE.md`：生成段由 `npm run arch:stats` 回写。

### 5. 数字锚扩到 README

`tools/number-anchors.mjs` 目前只校验 `ARCHITECTURE.md` 的生成段。把 `README.md` 里的关键数字（端点数、manifest 数、测试例数、门禁数、`app.js` 行数）也纳入校验——用锚点标记或改成生成段，自选一种；漂移即红。反证：临时把 README 里的端点数改错一位，`node tools/number-anchors.mjs --check` 必须红，贴输出后还原。

### 6. 台账与规划

- `docs/LEGACY-ITEMS.md`：清账批解决的逐条划掉并注明工单号；仍成立的遗留保留。
- `docs/plan/batch3-microkernel-plan.md` §4：B／C／D 与清账批的状态按实际写；里程碑口径按实际。
- `docs/plan/workorder-system-20261124.md`：编排器口径更新（隔离 e2e、不重启 8807、通用规则 11–13）。

### 6a. 第三批施工中新增、必须写进文档的东西（逐条核对，不许漏）

- **钩子贡献**：`activate()` 的 `hooks` 贡献、钩子名登记表、宿主按库快照取用（OS-195a）。
- **新增能力**：`fact.engine`／`fact.books`／`fact.write`／`fact.domain`、`storage.inventory` 等，以最终 manifest 为准逐项进 ADR 0002 §2.3。
- **边界规则**：四条消费路径（能力句柄／宿主组合面／钩子贡献／端点分派）、R-a～R-f、宿主只对两个宿主组合面放行、`src/protocol/` 文件白名单与 I/O 例外登记表、`host-api@2` 退役的记录（OS-195、195a、195b）。
- **货架**：五类货架投影成 module@2 套件的来源表；漫剧占位套件已删、legacy 页面模式退役（OS-192）。
- **分类**：页面 id＝slug、`imagegen`／`knowledge`、「日志」manifest（OS-190、190a）。
- **本机模块**：信任模型（登记即信任，不是沙箱）、边界门的运行期强制口径、端点归属规则与模块自带端点契约、钩子接入（OS-196、196a）；第三方工作台的页面（OS-198）。
- **迁移器**：执行时机、失败安全阀、回退保护（OS-197）。

### 7. 发布前检查

跑发布检查器 `C:\Users\Administrator\.zcode\skills\repo-publish\scripts\publish-scan.mjs`（先看它的用法说明再跑），全绿；有红项逐条处理或如实上报。

## 不做

- 不改产品代码（`src/**`、`public/**`）——发现文档与实现不一致时，以实现为准改文档；若发现的是实现的缺陷，写进 `LIMITATIONS` 上报，不在这张单里顺手改。
- 不改 `LICENSE` 的许可条款；不碰作者真库与真实 `%LOCALAPPDATA%`。

## 验收

- 机器门禁两轮全绿（含扩口径后的数字锚）；发布检查器全绿并贴输出。
- 回报里贴一张「文档—实现」对照自查表：ADR 0002 两张表、协议文档每一节、README 每个数字，各写「已核，证据」。
- 任务 5 的反证贴输出；`git diff --check` 干净。
