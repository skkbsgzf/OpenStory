# OS-199a · 文档收口返工：仓结构表、ADR 与协议里对不上实现的句子

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-199（Qoder 施工，落袋提交见看板；监督线验收部分通过）；清账批最后一张 |
| 对应 | OS-199 任务 1–6；D 批验收记录 §二 A3 |
| 依赖 | OS-197a、OS-198a（同轮连派的最后一单——数字以它们的终态为准） |
| 允许改动 | `docs/**`、`README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`tools/number-anchors.mjs`、`tools/acceptance/acceptance.mjs`、`test/numberAnchors.test.mjs`、`test/finalAudit.test.mjs`、`docs/number-anchors.json`、`docs/workorders/OS-199a-docs-rework.md` |
| 风险 | 低——只动文档与数字锚门禁 |
| 状态 | 已验收（监督线，2026-11-25）；提交 `18e7bed` |

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
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 843 · pass 841 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `README.md`
- `AGENTS.md`
- `docs/adr/0002-base-constitution.md`
- `docs/adr/0003-dynamic-loading.md`
- `docs/protocol/module-manifest-2.md`
- `docs/plan/batch3-microkernel-plan.md`

VERIFIED:
- `node tools/acceptance/acceptance.mjs` ×2：两次均 `验收门禁：29 过 / 0 挂 / 0 警`，退出码 0。
- `npm test` ×2：两次均 `tests 843 / pass 841 / fail 0 / skipped 2`，退出码 0。
- `node tools/number-anchors.mjs --check`：`✓ 数字锚一致：843 例／门禁 29／端点 108／宿主域 0／app.js 10107≤10500 行`；`npm run arch:check`：`✓ ARCHITECTURE.md 生成段与实测一致（51 行数据）`。
- `git diff --check`：退出码 0（仅 Git autocrlf 提示，无空白错误）；`git status --short` 仅上述 6 个文档，无临时脚本残留。
- 反证（把 `README.md:73` 的 108 改成 109 后跑 `--check`，随后已还原）：
'''
✗ 数字锚与文档/实测不一致
  · docs/number-anchors.json 与实测不符——跑 node tools/number-anchors.mjs 回写
  · README.md 缺当前端点数：108 个契约端点
  · README.md 缺当前测试数：843 例单测（840 过／2 跳过）
  · 全量测试未全绿：843 例 / 1 挂
'''
  额外两行来自 `test/numberAnchors.test.mjs` 同步读 README 触发（同一处人为改错所致），还原后复跑全绿。
- 本地等价 ADR 探针（监督线 `probe-199-adr.mjs` 不在仓内）：`2.3 内核行 7/7；2.4 工作台/宿主行 12/12` `✓ 两张表逐行与 manifest 一致`；探针写在仓外 `D:/tmp/` 并已删除。
- 发布检查器 `C:\Users\Administrator\.zcode\skills\repo-publish\scripts\publish-scan.mjs .` 原样输出：
'''
── ① 运行残留（不得被跟踪） ───────────────────────────────────────────────
✓ 运行残留未被跟踪
── ② 敏感文件 ──────────────────────────────────────────────────────
✓ 敏感文件（.env/密钥/凭据配置）未被跟踪
── ③ .gitignore 分区规范 ───────────────────────────────────────────
✓ .gitignore 存在且覆盖 node_modules/日志/.env
✓ .gitignore 有分区注释（依赖/运行产物/库内数据/本机环境）
── ④ 全历史凭据扫描（命中需人工甄别） ──────────────────────────────────────────
✓ 全历史无真实形态凭据命中
✓ 全历史未提交过密钥/env 文件
── ⑤ README 要件（人机双读） ───────────────────────────────────────────
✓ README 七要件齐备
── ⑥ 协议干净 ──────────────────────────────────────────────────────
✓ LICENSE 存在
    开源仓库必须有 LICENSE（受限/宽松均可，但要与 vendor 归属自洽）
✓ vendor 出处声明（VENDORED.md）
✓ package.json 元数据（repository/license/engines）
── ⑦ demo/演示目录干净 ───────────────────────────────────────────────
✗ 演示目录无运行残留且自带 README
    samples/水浒传/.openstory/（运行残留）
── ⑧ 提交信息规范（最近 30 条抽查） ─────────────────────────────────────────
⚠ 提交标题格式（对未来提交生效）
    历史 6 条偏长（已推送，不可改写）——新提交遵守 ≤72 字「type：摘要」规范
════════════════════════════════════════════════════════════════
✘ 1/11 项未过——修完重跑；全绿才允许推送
'''

「文档—实现」自查表：

| 范围 | 条目 | 结论与证据 |
|---|---|---|
| README 数字 | 21 manifest（12+7+2）／108 端点／843 例（841 过 2 跳）／29 检查／app.js 10,107 行 | 已核，`README.md:73` 与 `node tools/number-anchors.mjs --check`、`docs/number-anchors.json` 逐字一致 |
| README 数字 | node 徽章 ≥22.15.0 | 已核，`README.md:5` 与 `package.json:engines` 一致 |
| README 每行 | `src/protocol/` 行 | 已核，`README.md:86` 改底座契约清单；`ls src/protocol`＋`src/protocol/README.md` 登记，`chapters/factGuard→src/modules/prose/`、`libraryManifest→src/modules/storage/` |
| README 每行 | `src/kernel/` 行与 L2 示意图 | 已核，`README.md:67,87`；实测五个文件 `index/atomicWrite/fsDurability/errors/identity.mjs`，fact/enrich 在 `src/modules/fact/` |
| README 每行 | `src/services/` 行 | 已核，`README.md:89`；实测七个文件＝五货架＋`systemPrompt/syncCheck`，其余已归 `src/host/` |
| README 每行 | `workflows/` 行 | 已核，该行已删；仓根无该目录，样例在 `samples/qwen-image-2.1-t2i.json` |
| README 每行 | 「本机模块」节与其余行 | 已核，未改动；`README.md:100-106` 与 AGENTS「本机模块」、协议 §8.5 一致 |
| ADR 0002 | §2.3 七内核件表 | 已核，本地探针 7/7 与 21 份 manifest 的 `capabilities@version` 逐行一致；`docs/adr/0002-base-constitution.md:90,93` 已删两个不存在的证据文件 |
| ADR 0002 | §2.4 工作台表 | 已核，探针 12/12（含 agentbar/library）与 `requires` 逐行一致；表未改实质字段 |
| ADR 0002 | 其余六处 | 已核，`:61` 正式 slug、`:131` 工作流落点、`:264/271` 体裁套件、`:331` Agent 栏、`:353` §九标题、`:364` D6 状态均按实现改写 |
| ADR 0003 | §二基线／§三／§五 | 已核，`docs/adr/0003-dynamic-loading.md:27-60` 标题改「开门前基线」并逐条补现状；逐条对应 `capabilityGraph.mjs:52,292`、`moduleLoader.mjs:70-71,107`、`capabilityBindings.mjs:8-11`、`handlerTable.mjs:25`、`moduleRuntime.mjs:425` |
| 协议文档 | §1 状态／§5.4／§7.4／§10.1／§11／§13 | 已核，`:3,265,355` 统一为「按层原子切换已实施，剩余自注册旁路／第三方 runtime 命令」；`:517` 装载源含登记本机根；`:548` `host-api@2` 标退役；其余节未发现新矛盾 |
| AGENTS | 分层说明与端点数 | 已核，`AGENTS.md:15-19` 改为现行依赖方向＋`src/kernel/` 五文件口径；`:315` 105→108，与 108 契约端点一致 |
| 规划 | §1.3a 三行／§4 B/C/D 与清账批／§4.1 数字 | 已核，`docs/plan/batch3-microkernel-plan.md:105-106,125` 已实施状态；`:328-341` 补清账批工作包表；`:353` 10,107 与数字锚一致 |

LIMITATIONS:
- 发布检查器 ⑦ 红：`samples/水浒传/.openstory/` 是 `git ls-files` 已跟踪的演示配置（`project.json`/`ui-state.json`/`plugins/suite-state.json`，README:55 明确说明��演示库自带），而检查器按文件系统见 `.openstory/` 即判残留。该目录不在本单允许改动范围，未删除；故「除历史提交标题外全绿」未达成。⑧ 的历史标题数为 6 条（工单写 9 条），仅警示，不影响退出码。
- 监督线 `probe-199-adr.mjs` 未随仓分发，无法直接复跑；已用仓外等价探针核对两表并删除。
- BOARD 与 OS-197a/198a/199a 工单头仍标「待派」，与本轮实现终态不同步；这些文件不在六处返工范围，仅在规划 §4 注明「看板状态可能滞后，验收以监督线为准」。
- 未改任何产品代码（`src/**`、`public/**`），未碰 LICENSE、真库、8807，未执行 git 写操作。
```

## 验收记录（监督线，2026-11-25）

- 提交 `18e7bed`；门禁与数字锚两轮全绿。
- 六处逐条核过：`README.md` 仓结构表 4 行（`src/protocol`／`src/kernel`／`src/services`／`workflows/`）与分层示意图已按实现改写；ADR 0002 §2.5／§7.1／§2.3 证据列／§5.1／§九标题与状态已改；ADR 0003 §二改为「开门前基线（逐条附现状）」；协议文档删去 `host-api@2` 现存入口行、把热切换口径与 ADR 对齐；`AGENTS.md` 分层说明已改；规划 §1.3a 两个 slug 与运行时套件归属不再是「待定」。
- 反证：把 `README.md` 端点数改错一位 → `number-anchors --check` 红（施工方已贴，监督线复核）。
- 结论：**已验收**。
