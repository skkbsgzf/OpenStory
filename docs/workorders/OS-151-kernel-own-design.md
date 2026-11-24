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

## 验收记录（主 agent 填）
