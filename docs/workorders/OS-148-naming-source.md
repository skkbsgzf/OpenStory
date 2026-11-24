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

> 模型 deepseek-v4.1-flash · 第 1 轮 · 测试 绿（tests 523 · pass 521 · fail 0 · skip 2） · 门禁 绿 · 水浒 绿 · 新建 绿 · vendor 未动 · daemon 在跑

```text
CHANGED:
- `public/views/registry.mjs` — 新增 `NAMING_TABLE`（19 概念 × 概念 id／`dir`／`tab`／`panelLabel`／`logModule`／`contract`／`mcpPrefix` 六列＋`dirLabel`／`dirLogModule`／`dirTab` 三列实况补注）＋查表纯函数 `namingEntry`／`namingEntryForDir`／`logModuleForDir`／`logModuleForView`／`LOG_MODULES`；`DIR_LABELS`／`DIR_ORDER`／`READONLY_DIRS`／`PAGE_TO_DIR_LOCAL` 与 `TAB_REGISTRY` 九条页签的 `dir`/`label`/`panelLabel` 全部改由表派生（`tabNaming()`）
- `public/app.js` — `moduleOfCurrentView()` 的 5 段字面量映射改为 `registryModule.logModuleForView(state.view)`（12,477 → 12,472 行，只减不增）
- `src/protocol/naming.mjs`（新建）— Host 侧取表口，只 re-export
- `src/protocol/chapterWrite.mjs` — `moduleOfPath` 的 `拆解 → 故事源` 硬编码改 `logModuleForDir()`
- `src/protocol/libState.mjs` — `module: '界面状态'` → `LOG_MODULES.uiState`
- `src/protocol/README.md` — 登记 naming.mjs 转供件＋豁免台账新行
- `src/api/handlers/fact.mjs` — 两处 `module: '拆解'` → `LOG_MODULES.storysource`
- `src/services/enrichEngine.mjs` — `module: '拆解'` → `LOG_MODULES.storysource`
- `src/services/habits.mjs` — `module: '习惯'` → `LOG_MODULES.habits`
- `src/modules/deduce/deduceSession.mjs` — `DEDUCE_SESSION_DIR` 取表 dir、`module: '推演'` → `LOG_MODULES.roleplay`
- `test/naming.test.mjs`（新建）— 5 例：表覆盖页签／表覆盖日志模块（显式清单＋src 无中文 module 字面量）／契约域与 MCP 前缀真实存在／单一来源（映射逐键派生＋app.js 无第二份）
- `tools/acceptance/acceptance.mjs` — 新增 S2.5「命名真源表一致」（16 → 17 项）
- `AGENTS.md` — 硬规则 21「新增或改名一个概念，先改命名表」；验收数字 510 例 → 523 例、16 → 17 检查
- `PUBLISHING.md` — 新增检查单 ⑥「命名真源一致」（指向 S2.5 与 test/naming.test.mjs）
- `ARCHITECTURE.md` — L7 新增「命名单一真源（OS-148）」段（表在哪、谁消费、为什么落在注册表）；L7 数字重测为 18 文件 / 20,716 行、app.js 12,472 行
- `docs/ACCEPTANCE.md` — 16 → 17 检查、单测 467 → 523 例、S2 检查面补 S2.5

表的最终内容（`public/views/registry.mjs` 的 `NAMING_TABLE`，列：id｜目录｜页签｜面板名｜日志模块｜契约域｜MCP 前缀）：

'''
chapters    正文   正文    —     正文        chapters   openstory_novel_
reference   参考   世界书  参考   参考        reference  openstory_reference_
worldbook   世界书  —      —     —           —          —
script      剧本   剧本    —     剧本        chapters   —
storysource 拆解   故事源  —     拆解/故事源  fact       openstory_fact_curve
roleplay    推演   扮演    —     推演        fact       openstory_deduce_
habits      习惯   习惯    习惯   习惯        system     openstory_habits_
log         日志   日志    —     —           chapters   —
artifacts   —     产物    —     —           system     —
settings    —     设置    —     —           system     —
uiState     —      —      —     界面状态     system     —
libraries   —      —      —     —           library    openstory_libraries
analysis    —      —      —     —           —          openstory_analysis_chapter
enrich      —      —      —     拆解        fact       openstory_enrich_
vision      —      —      —     —           system     openstory_vision_describe
imagegen    —      —      —     —           reference  openstory_image_generate
kb          —      —      —     —           system     —
shelf       —      —      —     —           plugins    openstory_skills_
agent       —      —      —     —           agent      —
'''

改掉的映射点（文件:符号）：
- `public/views/registry.mjs:DIR_LABELS`（`拆解: '故事源'` 等五条字面量）→ 表派生
- `public/views/registry.mjs:DIR_ORDER` / `READONLY_DIRS` / `PAGE_TO_DIR_LOCAL` → 表派生
- `public/views/registry.mjs:TAB_REGISTRY` 九条页签 `dir`/`label`/`panelLabel` → `tabNaming()`
- `public/app.js:moduleOfCurrentView`（view→正文/参考/习惯/推演）→ `logModuleForView()`
- `public/app.js:groupLabel`、`scriptViewHtml`、`dirViewHtml` 三处目录→显示名 → 经已派生的 `DIR_LABELS`（等价，零改动）
- `src/protocol/chapterWrite.mjs:moduleOfPath`（拆解→故事源）→ `logModuleForDir()`
- `src/api/handlers/fact.mjs:742,1065`、`src/services/enrichEngine.mjs:761`、`src/modules/deduce/deduceSession.mjs:281`、`src/services/habits.mjs:110`、`src/protocol/libState.mjs:102` → `LOG_MODULES.*`
- `src/modules/deduce/deduceSession.mjs:DEDUCE_SESSION_DIR`（'推演'）→ 表 `roleplay.dir`

VERIFIED:
- `node --check` 对 11 个改动的 js/mjs 文件全过
- `node --test test/*.test.mjs` → tests 523 / pass 521 / fail 0 / skipped 2（既有 skip，未新增跳过）；本单新增 5 例，518→523
- `node --test test/tabRegistry.test.mjs` → 12/12 绿，缺省页签快照文件一字未改
- `node --test test/naming.test.mjs` → 5/5 绿
- `node tools/acceptance/acceptance.mjs` → 17 过 / 0 挂 / 0 警（含新增 `S2.5 命名真源表一致`）
- `wc -l public/app.js` → 12,472（原 12,477，未增长）
- 用 node 直接 import registry 校验派生值：`DIR_LABELS`＝`{正文,世界书,剧本,拆解:故事源,日志}`、`DIR_ORDER`＝正文/世界书/剧本/日志、`READONLY_DIRS`＝日志、`PAGE_TO_DIR_LOCAL` 四键，与改前逐字节一致；`moduleOfPath` 九个路径样例输出与改前一致

LIMITATIONS:
- 表落在 `public/views/registry.mjs` 而非独立 `public/naming.mjs`：注册表有「零 import」纯度门禁（test/tabRegistry.test.mjs），独立成文件就必须 import，与门禁冲突且不许放宽既有断言。代价是 `src/protocol/naming.mjs → public/views/registry.mjs` 一条转供边（protocol→public），已按仓内规矩登记进 `src/protocol/README.md` 豁免台账；若日后有真正的前后端共享数据层，这条边应随之消失。
- 「拆解」概念的 changelog 模块名实况有两个：显式写入用「拆解」（fact/enrich），按目录推断用「故事源」（moduleOfPath，OS-107 起既有库日志就在这个目录名里）。表用 `logModule`＋`dirLogModule` 两列并存以保行为不变，未迁移既有日志目录。
- 未改的三处审计项（列出而非偷改）：`public/app.js` 的 `dirRows` 过滤（`dir !== '正文' && dir !== '世界书' && dir !== '推演'`，是页签归属判定而非显示名映射）、`public/app.js:DECISION_LABELS`（建库导入决策 id → 分类名，含大纲/构思/资料/约束等已退场概念，不属五层命名）、各处 `moduleLogHtml('参考')`/`loadModuleLog('推演')` 这类直接传模块名的实参（非拼接映射）。
- MCP 工具名按工单要求一字未改，表只登记前缀供核对。
- 没有启动 daemon、也没有做浏览器端点击验证（工单禁止启动进程）；前端改动靠 node 直接 import 注册表做等价校验＋单测＋门禁断言。
```

## 验收记录（主 agent 填）
