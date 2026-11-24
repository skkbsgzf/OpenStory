# OS-151 · 内核转自有：定名与归属（设计单）

| 项 | 值 |
|---|---|
| 批次 | 段 B·内核转自有（第 1 步，只出设计稿） |
| 对应 | 作者裁定（2026-11-24）：全部转自有——之前只是图方便临时参考 Pinax 内核，现在基于 OpenStory 自己的架构重新命名内核与相关业务构成，架构上有更高的自由度 |
| 依赖 | 段 A（OS-148 的命名表已落地） |
| 允许改动 | `docs/plan/kernel-own-design.md`（只此一个文件） |
| 风险 | 低（不迁代码） |
| 状态 | 待派 |

## 目标

把「内核转自有」从一句话变成一张可执行的图纸：内核叫什么、由哪些部分组成、24 个文件各归哪里、哪些名字改哪些不改、分几步迁、每步怎么证明没坏。
**作者过目命名之后才开始迁代码**（OS-152 起）。所以这份稿子首先是给人拍板用的，其次才是给施工用的。

## 动工前必读

- `docs/plan/workorder-system-20261124.md` 的 §1（对第二批清单的事实核对）与 §3 段 B（含「默认命名与归属方案」——以它为底稿）。
- `docs/plan/route-batch2-20261123.md`：路线原文与红线（金样不动、旧库不迁移、每步独立提交）。
- `core/VENDORED.md`；`core/pinax/` 下全部 24 个文件的头部注释与 import 关系。
- `src/kernel/`（`pinaxAdapter.mjs` 与同目录其它文件）；`src/protocol/hostWrite.mjs`、`factGuard.mjs`；Host API（OS-142）。
- `test/decoupleStep2.test.mjs`（金样）、`test/vendorDrift.test.mjs`（16 例，段 B 末退役）。
- `public/views/registry.mjs` 的 `NAMING_TABLE`（OS-148）。
- `ARCHITECTURE.md` 的分层表与生成段。

## 任务（全部写进 `docs/plan/kernel-own-design.md`，九节）

### 1. 现状盘点（实测，带文件:行）

- 24 个文件逐个列：路径、行数、职责一句话、被仓内非测试代码里的谁直接或间接使用。
- 全仓「Pinax 谱系的名字」清单：搜 `pinax`、`Pinax`、`PINAX`、`pedia`、`Pedia`、`next/`、`electron/`（排除 `node_modules`、`.git`、`docs/plan` 里的历史记录），每一条分到三类之一，并给出证据（它被写到哪、被谁读）：
  - **磁盘格式名**：落在磁盘上，改了会让作者既有库或 Pinax 桌面端读不了的（例如 `.pinax/`、`pinax-project@3`、`pinax.carrier.*`、`pinax-wiki-derived@1`，以及任何被写进日志或对外返回的错误码）；
  - **对外契约名**：API 与 MCP 对外的字符串（端点路径、工具名、错误码）；
  - **纯代码内部名**：文件名、目录名、符号名、注释、常量文案——可以随意改。

### 2. 内核定名与身份

以体系文档 §3 的默认方案为底稿：OpenStory 内核、身份串 `openstory-kernel@1`、位置 `src/kernel/`。写明身份常量放哪、谁导出；模块 manifest 要不要声明兼容的内核版本——给出建议与理由，不强求。

### 3. 归属图

24 个文件逐个写明目标位置。默认：管道件与 fact 链留 `src/kernel/`，推演链 8 件进扮演模块自己的引擎目录（`src/modules/deduce/` 下）。
读完代码后如果你认为某个文件的归属应当不同，写明理由。`vendor/contracts/worldbookFileContract.js` 一并给出目标位置。

### 4. 改名对照表

旧名 → 新名：文件路径、导出的符号、常量文案、错误码前缀。每行注明「为什么改」或「为什么不改」。对外契约名与磁盘格式名一律标「不改」。

### 5. `pinaxAdapter` 解散方案

五组出口（factStore／deduce／enrich／projectMeta／projectImport）各自的消费方改从哪里取；Host API 如何承接；
门禁 S2.4 从「唯一 import core 的地方」怎么一步一步走到「无 core 可 import」，再到退役。

### 6. 迁移步骤

按体系文档的六步（OS-152 到 OS-157）逐步写明：迁哪些文件、改哪些 import、新增或保留哪些测试、这一步的金样与红线测试清单、回滚办法（一步一提交，回退一个提交即回滚）。步骤之间的先后依赖写清。

### 7. 互认金样

段 B 末要退役 vendor 漂移检测，之后与 Pinax 桌面端的互认只靠落盘格式。
设计一套互认金样：冻结一份由 Pinax 桌面端真实产生的库片段（`project.json`、一个 fact 文件、一个 wiki 派生档），测试断言 OpenStory 读得进、写得出、字段逐项相等。
写明夹具从哪来、放哪、测试怎么写。夹具本身由主 agent 提供，你只设计。

### 8. 出处声明

内核转自有后，README 致谢段、`src/kernel/` 各文件头注释、`PUBLISHING.md` 怎么写出处（现 `core/VENDORED.md` 记的是 Pinax-next `feat/pinax-electron-next` @ `70a4f44`）。给出成稿文字。

### 9. 未决事项

盘点中发现的、需要作者拍板的点，单列一节，每条附你的建议。

## 不做

- 不迁代码；不改 `core/**`、`vendor/**`、`src/**`、`public/**`、`test/**`；不动看板与本工单以外的文档。
- 不跑不带 `--check` 的 `node scripts/arch-stats.mjs`（它会回写文档）。

## 验收

- 设计稿九节齐全。
- 盘点数字与实测一致（主 agent 会抽查：24 文件 4,332 行、消费方清单、三类名字的归类）。
- 每个「不改」的判断都有证据；每个迁移步骤都能独立提交与回滚。
- 交付说明附：设计稿目录，以及你认为最需要作者拍板的三件事。

## 纪律

- 只写 `docs/plan/kernel-own-design.md` 这一个文件，越界的不提交。
- 结论必须来自你读到的代码或跑的只读命令，不许凭印象；拿不准的写进「未决事项」。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 遇到规格互相矛盾或做不到——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

> 模型 deepseek-v4.1-flash · 第 1 轮 · 测试 绿（tests 537 · pass 535 · fail 0 · skip 2） · 门禁 绿 · 水浒 绿 · 新建 绿 · vendor 未动 · daemon 在跑

```text
CHANGED: `docs/plan/kernel-own-design.md`（新建，九节齐全）

VERIFIED:
- `find core/pinax -type f | wc -l` → 24；`… | xargs wc -l | tail -1` → 4332（与设计稿 §1.1 逐行表一致）
- `grep -rn "from '.*core/" src/` → 仅 `src/kernel/pinaxAdapter.mjs`；`grep -rn pinaxAdapter src/ tools/` → 10 个消费方（§1.3）
- `grep -rli "pinax\|pedia"`（排除 node_modules/.git/docs/plan/.ua/.zcode/tmp）→ 155 文件、src 41 个
- `node tools/acceptance/acceptance.mjs` → **18 过 / 0 挂 / 0 警**（改动只有一份 markdown，门禁不受影响）

LIMITATIONS:
1. 工单 OS-152 的验收口径写「vendor 清单除名 2 项」，在设计里被**顺延到 OS-156**：`core/factFileStore.mjs:6` 与 `core/fs/atomicWrite.mjs:4` 让「core 内文件不许 import src」与「src 除 adapter 外不许 import core」两条硬规则对撞，只能走「影子复制→重指向→最后一个 core 消费者搬走时删除」。已在 §0.3-1、§6.7、§9-12 写明，请主 agent 确认修改口径。
2. 工单「内核错误码 `PINAX_` 前缀换成自己的（对外字符串不变）」字面自相矛盾——该前缀就是 `/api` 响应里的 `code`（`handlers/fact.mjs:737`），且被 3 处测试＋2 处 `^PINAX_` 解析钉死。设计取「只改表名/注释、值不动」，列入 §9-1 待作者拍板。
3. 推演链归模块会导致 `fact.deduce` 退出 Host API（`host-api@1→@2`）。这是按默认归属推出来的必然代价，属设计判断而非实测，§9-3 给了「留内核」的备选。
4. 互认夹具（Pinax 桌面端真实产库）我没有、也不该伪造；§7 只定形状、位置、`PROVENANCE.json` 与断言清单，实际抓取需主 agent/作者提供。
5. 未运行全量 `node .zcode/run-gate.mjs`（本单只动文档，按工单要求跑的是验收门禁）；未执行任何 git 命令，未启停 daemon。
```

## 验收记录（主 agent 填）

- 2026-11-24 交付 `docs/plan/kernel-own-design.md`（九节＋附录复核命令），五道门禁绿、无越界、未改任何代码。
- 主 agent 抽核：`find core/pinax -type f | wc -l` = 24；`xargs wc -l` = 4,332；`grep -rn "from '.*core/" src/` 只命中 `pinaxAdapter.mjs`——与设计稿 §1 一致。
- 设计稿提出三处结构性发现，其中一条是对工单验收口径的**实质修改**，主 agent 裁定：
  1. **接受**「影子复制 → 重指向 → 延后删除」：core 侧不许 import `src/`（硬规则 1），`src/` 侧除 adapter 外不许 import `core/`（门禁 S2.4），两条夹住后删除只能发生在最后一个 core 侧消费者搬家那一步。
     因此 OS-152 原写的「vendor 清单除名 2 项」**顺延到 OS-156** 统一处理；OS-152 验收改为「自有副本直测覆盖」。
  2. **接受** `PINAX_*` 错误码字符串不改（只改表名与注释）：这些字符串就是 `/api` 出去的 `code`，三处测试逐字钉死，改＝破坏对外契约。
  3. **待作者拍板**：内核名 `openstory-kernel@1`／位置 `src/kernel/`；推演链归模块（代价 `host-api@1→@2`）；若作者不愿动 Host API，备选＝推演 8 件留 `src/kernel/deduce/`。
- 结论：**已验收（设计稿）**；代码迁移（OS-152 起）等作者对上面三件事的一句话确认后开工。
