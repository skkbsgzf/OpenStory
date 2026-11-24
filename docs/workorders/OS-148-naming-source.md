# OS-148 · 五层命名单一真源表（G8a＋G8d）

| 项 | 值 |
|---|---|
| 批次 | 段 A·立规矩（第二批路线 批次 7） |
| 对应条目 | G8a、G8d |
| 依赖 | 无 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`AGENTS.md`、`ARCHITECTURE.md`、`PUBLISHING.md`、`docs/**` |
| 风险 | 低（不改任何行为，只收敛命名的来源） |
| 状态 | 待派 |

## 目标

同一个概念在「磁盘目录／UI 页签／changelog 模块／契约域／MCP 名」五层各有一个名字，现在没有任何一处能回答「世界书这一摊东西在各层分别叫什么」。
本单立一张**单一真源表**，并让各层的映射点从表里取名。

## 动工前必读

- `public/views/registry.mjs`：`DIR_LABELS`、`PAGE_TO_DIR_LOCAL`、`TAB_REGISTRY`（条目上的 `dir`／`label`／`panelLabel`）。页签层已在 OS-143 收成声明式。
- `src/protocol/changelog.mjs` 与各处 `recordChange(...)`、`module: '…'` 实参：日志模块名现状有 `正文`、`参考`、`拆解`、`推演`、`界面状态`。
- `src/api/contracts/*.mjs`（七个域文件）与 `src/api/registry.mjs`；`src/host/mcp.mjs` 里 24 个 `openstory_*` 工具名。
- `AGENTS.md` 第 10 条的落盘位置表。
- `public/app.js` 的增量冻结规则（`AGENTS.md` 第 20 条）。

## 主 agent 审计到的初值

逐格核实后再填表；与实况对不上的格，写进交付说明的 LIMITATIONS。

| 概念 id | 目录 | 页签 | 面板名 | changelog 模块 | 契约域 | MCP 前缀 |
|---|---|---|---|---|---|---|
| `chapters` | 正文 | 正文 | — | 正文 | chapters | `openstory_novel_` |
| `reference` | 参考 | 世界书 | 参考 | 参考 | reference | `openstory_reference_` |
| `script` | 剧本 | 剧本 | — | 待核 | 借用 chapters | — |
| `storysource` | 拆解 | 故事源 | — | 拆解 | fact | `openstory_fact_curve` |
| `roleplay` | 推演 | 扮演 | — | 推演 | fact | `openstory_deduce_` |
| `habits` | 习惯 | 习惯 | 习惯 | 待核 | system | `openstory_habits_` |
| `log` | 日志 | 日志（只读） | — | 待核 | — | — |

日志、产物、设置、库管理、分析、生图识图、知识库各行按实测补齐。

## 任务

1. **建表**：一个纯数据模块，导出命名表（概念 id ＋ 上表六列）与几个查表纯函数（按目录名、页签名、模块名反查）。
   **全仓只许有一份表的数据。** 前后端都要用它，而浏览器拿不到 `src/`：
   建议表放 `public/` 下的零依赖纯数据模块（先例：daemon 直接 import `public/analysis.mjs`），`src/protocol/` 只做 re-export、不复制。
   若你选别的单一来源机制（例如下发端点），在交付说明里写明理由。
2. **各层改为取表（行为不变）**：
   - 前端：`registry.mjs` 里「目录 → 页签名」「面板名」由表派生（引用同一个对象，不许抄第二份字面量）；
     `public/app.js` 里凡是由代码拼出来的「目录名 → 显示名」映射点，逐个改为取表。**只改映射点，文案句子里的概念名不动。**
   - 后端：changelog 模块名、产物分组名等由代码拼出来的显示名，改为取表；散落的字面量映射删掉。
   - MCP：**工具名本单不改**（改名会破坏外部调用方），只把 24 个工具名的前缀登记进表，供核对。
3. **一致性测试**（新建 `test/naming.test.mjs`）：
   - 表覆盖页签：`TAB_REGISTRY` 每个未退场条目的 `dir`／`label`／`panelLabel` 都能在表里查到且相等；
   - 表覆盖日志模块：代码里实际用到的 changelog 模块名集合 ⊆ 表的模块列（测试里维护一份显式清单，漏登＝红）；
   - 表的两列取值都真实存在：契约域是 `src/api/contracts/` 下的文件名，MCP 前缀能在 `mcp.mjs` 的工具名里找到；
   - 单一来源：`registry.mjs` 导出的映射与表是同一个对象引用，或由表逐键派生（断言没有第二份字面量）。
4. **门禁**：`tools/acceptance/acceptance.mjs` 新增一项「命名真源表一致」（跑上面前两条；检查项只增不减）。
5. **文档同批**：
   - `AGENTS.md` 新增硬规则：新增或改名一个概念，先改命名表再改代码；五层的名字只从表里取。
   - `PUBLISHING.md` 登记对应检查项（指向仓内那条门禁命令）。
   - `ARCHITECTURE.md` 补一段：表在哪、谁消费。

## 关于 G8d

清单原文：「`daemon.mjs:802` 的 拆解→故事源 临时改名并入命名表」。
主 agent 已核实：那一处已不存在（daemon 在 OS-140/141 拆进了 `src/host/` 与 `src/api/handlers/`）；这个映射现在在 `registry.mjs` 的 `DIR_LABELS`（`拆解: '故事源'`）和 `app.js` 的若干处。
所以 G8d 在本单的落地就是上面任务 2。你审计到的全部映射点（文件:符号）列进交付说明。

## 不做

- 不改 MCP 工具名、不改端点路径、不改目录名（世界书目录归属是 G8b，另行处理）。
- 不迁移任何既有库的目录。
- 不动 `core/**`、`vendor/**`；不引任何依赖；`package.json` 不动。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 518 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（当前 16 项，本单后 17 项）。
- `public/app.js` 行数不增（当前 12,477）。
- `test/tabRegistry.test.mjs` 的缺省页签快照一个字不改，仍然绿——页签集合与顺序不变。
- 交付说明里附：表的最终内容、改掉的映射点清单、LIMITATIONS。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库，也不要改本机库清单。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
