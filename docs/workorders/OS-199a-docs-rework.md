# OS-199a · 文档收口返工：仓结构表、ADR 与协议里对不上实现的句子

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-199（Qoder 施工，落袋提交见看板；监督线验收部分通过）；清账批最后一张 |
| 对应 | OS-199 任务 1–6；D 批验收记录 §二 A3 |
| 依赖 | OS-197a、OS-198a（同轮连派的最后一单——数字以它们的终态为准） |
| 允许改动 | `docs/**`、`README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`tools/number-anchors.mjs`、`tools/acceptance/acceptance.mjs`、`test/numberAnchors.test.mjs`、`test/finalAudit.test.mjs`、`docs/number-anchors.json`、`docs/workorders/OS-199a-docs-rework.md` |
| 风险 | 低——只动文档与数字锚门禁 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 已经站得住、不要动坏的部分（监督线实测）

- 数字锚已扩到 `README.md`：21 份 manifest、108 个契约端点、836 例单测、29 项验收检查、`app.js` 行数都由 `tools/number-anchors.mjs --check` 校验。
- ADR 0002 §2.3 七内核件表与 §2.4 工作台表：**与 21 份 manifest 逐项一致**（17 个能力 id 全在、12 个工作台的 requires 全对）。
- 早先点名的过时项已清：`text.lint`、`agent.embedding`、`storage.library`、「14 份」、`core/VENDORED.md` 在 ADR、协议、README、AGENTS、台账里零命中；`prose.changelog` 只作为「未登记为独立能力」的说明出现；`host-api@2`、`recentProjects` 在 AGENTS／ARCHITECTURE／台账里是退役记录。
- `README.md` 有「本机模块」一节；发布检查器 11 项里 10 项绿，余下 1 项是已推送的 9 条历史提交标题偏长（警示级，只对未来提交生效，已推送历史不改写）。

## 要返工的（监督线逐处实测）

### 1. `README.md` 仓结构表还有四行对不上实现

- `src/protocol/` 行写着 `chapters`、`factGuard`、`libraryManifest`——前两个早已搬走，`libraryManifest` 在 `src/modules/storage/`。
- `src/kernel/` 行写「管道件＋fact 链＋enrich」——fact 链与 enrich 早已在 `src/modules/fact/`，`src/kernel/` 现在只有写管道、错误词表与身份（五个文件）。
- `src/services/` 行列了十几个文件——现状只有七个：货架装载五个（`genres`、`runtimes`、`skills`、`stylePacks`、`suites`）＋ `systemPrompt`、`syncCheck`。
- `workflows/` 行——仓根没有这个目录。
- 分层示意图里「L2 `src/kernel/` 自有内核（管道件／fact 链／enrich）」同样过时。

### 2. ADR 0002 里的过时句子

- §2.5 生图工作流包的落点写 `workflows/`（目录不存在）。
- §7.1「`DEMO.md` 口径」一行仍写「Agent 栏仍写 Pi-Agent 归本稿后续命名批」——OS-190 已改成「Agent 栏」。
- §2.3 的「当前代码证据」列引用了已删除的文件（`src/protocol/text.mjs`、`src/protocol/media.mjs` 等）。
- §5.1 仍写「体裁……尚未升成 `class:suite` 的独立供给」——OS-192 起体裁已经投影成套件；没做的部分（体裁模板闭包写进能力图）照实单列。
- §九标题「待作者裁定」与 D1–D8 的状态：这些已按作者「不接受妥协」的裁定全部实施，标题与状态要改成事实。
- §二表头「建议 slug」——已经是正式 slug。

### 3. ADR 0003 §二「现状盘点」是开门前的话

「本机目录尚未进入装载源」「尚未接管端点/页面注册」——这些是 OS-196 之前的盘点。整节标成「开门前基线」，或逐条补「现状」。

### 4. 协议文档 `docs/protocol/module-manifest-2.md`

- :548 附近仍把 `host-api@2` 当作现存入口列在版本表里。
- 开头与 :355 写「全局热切换仍未实施」，而 ADR 0003 写切换门已成立——两处说法要对齐：写清楚按层原子切换已做、还剩什么没做。

### 5. `AGENTS.md` :16 的分层说明过时

「L4 自持层→L2 自有内核 `src/kernel/`→L1 磁盘库；OS-157 起 L2/L3 合并」。

### 6. 规划 `docs/plan/batch3-microkernel-plan.md` 的状态没跟上

- §1.3a 不一致清单里「生图与识图」「知识库」两行仍是「待作者定」——OS-190 已实施 `imagegen`、`knowledge`；「运行时套件归属待定」——已定为套件的 `runtime` 供给。
- §4 的 B／C／D 与清账批状态按实际写。

## 任务

把上面六处逐条改到与实现一致；在回报里贴一张「文档—实现」自查表（README 每个数字与每一行、ADR 0002 两张表、协议文档每一节、AGENTS 分层说明、规划状态，各写「已核，证据」）。数字以 OS-197a、OS-198a 之后的终态为准（`node tools/number-anchors.mjs` 回写）。

反证：把 `README.md` 里的端点数改错一位 → `node tools/number-anchors.mjs --check` 必须红，贴输出后还原。跑发布检查器 `C:\Users\Administrator\.zcode\skills\repo-publish\scripts\publish-scan.mjs`，贴输出。

## 不做

- 不改产品代码（`src/**`、`public/**`）——发现实现缺陷就写进 `LIMITATIONS` 上报，不在这张单里顺手改。
- 不改 `LICENSE`；不碰作者真库与真实院子；不重启、不连接 8807。

## 验收

- 机器门禁两轮全绿；发布检查器除历史提交标题那条外全绿。
- 监督线复跑 `probe-199-adr.mjs`（两张表逐行一致）并抽查上面六处。
- `git diff --check` 干净。
