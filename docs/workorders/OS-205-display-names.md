# OS-205 · 显示名迁入投影：命名表退掉模块页签列

| 项 | 值 |
|---|---|
| 批次 | 第四批第 6 张（最后一张）；规划见 [`plugin-frontend-batch-20261126.md`](../plan/plugin-frontend-batch-20261126.md) §5 |
| 对应 | 规划书 §三-4「显示名权威迁移」；监督线实况 §4 第 9 条；规划 §3 裁定第 2 件 |
| 依赖 | OS-204 |
| 允许改动 | `public/views/registry.mjs`、`public/views/referencePageViews.mjs`、`public/views/settingsViews.mjs`、`public/app.js`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中高——动命名单一真源表，以及三条拿它当对照真源的门禁；**口径等价、强度不降** |
| 状态 | 待立细（等 OS-204 验收后由监督线按当时实况补齐，再派） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

模块显示名的权威只有 manifest（`name` 与 `pages[].label`），经 `/api/plugins` 投影下发；前端命名表不再保存模块页签名的第二份。三名一致（显示名＝库内目录名＝修改日志模块名）改由门禁与测试拿 **manifest 的显示名**去对命名表的目录列与日志列——保证不变，对照的真源换了。

## 现状（监督线 2026-11-26 实测）

- 页签栏其实已经读投影里的页面名（`registry.mjs` 的 `projectedTabDefs` 取 `placement.label`，来自 manifest `pages[].label`）；`public/views/registry.mjs` 的 `NAMING_TABLE` 里 `tab`／`panelLabel` 两列是留着的第二份。
- 这第二份被当成对照真源用着：验收门禁 S2.5（`page.label !== row.tab`）、S2.9（`tools/verify/verify-os172-naming.mjs` 的 `auditNamingConsistency`：第 56 行目录对页签、第 65 行 manifest 名对页签）、S4.1（`namingEntry(entry.id)?.tab` 取核心页签名），以及 `test/naming.test.mjs`（「表覆盖页签」）、`test/os172Naming.test.mjs`（四向一致）。
- 命名表的其他列——目录名、日志模块名、契约域、MCP 前缀——后端约 28 个文件经 `src/protocol/naming.mjs` 在用，一个都不能动。
- 表外还有一处从表里读模块页签名：`public/views/referencePageViews.mjs:66` 的 `namingEntry('worldbook').tab`（世界书图谱的图例）。

## 任务

### 1. 命名表退掉模块页签列（`public/views/registry.mjs`）

12 个模块页面所在的行（`chapters/worldbook/script/storysource/roleplay/habits/log/artifacts/analysis/imagegen/knowledge/exchange`）不再写 `tab`／`panelLabel`；这两列只留给宿主自有页面（`settings`）。表头注释同步改写：表管目录名／日志模块名／契约域／MCP 前缀，模块显示名的权威是 manifest。`DIR_LABELS`／`DIR_ORDER`／`READONLY_DIRS`／`PAGE_TO_DIR_LOCAL`／`LOG_MODULES` 的**取值一个不变**（有目录的行回落到目录名，本就同名）。

### 2. 前端不再有第二份模块名

`referencePageViews.mjs` 那处改从投影取页面名（经 scope 注入，取不到回落页面 id）。全仓扫一遍，前端别处不许再从表里读模块页签名。

### 3. 门禁与测试改指 manifest（等价加强，不放宽）

- **S2.5**（`tools/acceptance/acceptance.mjs`）：每条页签位置——概念在表里有行；有目录且未显式排除的行，`page.label === row.dir`；并加一条新断言 `page.label === manifest.name`。另加一条：模块概念所在的行**不许**带 `tab`／`panelLabel`（防第二份回潮）。检查项编号与数量不变。
- **S2.9**（`auditNamingConsistency`）：目录对页签那一处改成「目录名对 manifest 的页面名」（非模块概念仍对 `tab`）；manifest 名那一处改成对目录名或页面名。新增断言：12 个工作台 manifest 的 `pages[].label` 都等于自己的 `name`。分类表正名（`WORKBENCHES`）的核对保留。
- **S4.1**：核心页签名改从 manifest 的 `pages[].label` 取。
- **`test/naming.test.mjs`**：「表覆盖页签」改成「manifest 显示名对表目录列一致，且表不再存模块页签名」；`namingEntry('settings')?.tab === '设置'` 与「单一来源」各条保留。
- **`test/os172Naming.test.mjs`**：四向一致改指新口径；反证用例（目录名退回旧名时报红）要仍然有效。
- **`test/shellViewsC6.test.mjs`**：第 176 行夹具里的 `tab` 随注入方式变化调整。
- `test/tabRegistry.test.mjs`「八个工作台页签顺序与显示名只来自 manifest」「词表映射原样保真」两条必须原样通过。

### 4. 文档

`AGENTS.md` 第 21 条（现在写的是「页签名在 manifest `pages[].label` 与表 `tab` 列逐字一致（S2.5）」）改成新口径；`docs/UX-STRUCTURE.md` 相关句子同步。

## 实况补细（监督线 2026-11-26，HEAD `b2083d4` 实测）

模块行里带 `tab` 的一共 12 行（chapters/worldbook/script/storysource/roleplay/habits/log/artifacts/analysis/imagegen/knowledge/exchange），其中 `artifacts`/`analysis`/`imagegen`/`knowledge` 四行**没有 `dir`**——它们退掉 `tab` 后不能靠目录名回落，页面名的唯一来源就是 manifest 的 `pages[].label`（这四件的 label 分别是 产物／分析／生图与识图／知识库，与现在表里的 `tab` 逐字相同）。

真正的消费者只有四处，逐处改：

| 处 | 现在 | 改成 |
|---|---|---|
| `public/views/registry.mjs` 的 `dirLabelOf(row)` | `row.dirLabel ?? row.tab ?? row.dir` | `row.dirLabel ?? row.dir ?? null`（`DIR_LABELS` 由目录名派生，取值不变） |
| `public/views/referencePageViews.mjs:72` | `namingEntry('worldbook').tab` | 经 scope 注入的 `pageLabel('worldbook')`（取投影里该页面 id 的 label，取不到回落 `'世界书'`） |
| `tools/acceptance/acceptance.mjs` S2.5（第 402 行附近） | `page.label !== row.tab` | `page.label !== row.dir`（有 `dir` 的行）；**另加** `page.label !== manifest.name` 与「模块行不许有 `tab`/`panelLabel`」两条新断言 |
| `tools/acceptance/acceptance.mjs` S4.1（第 608 行） | `namingEntry(entry.id)?.tab` | 从 `MODULE_MANIFESTS` 的 `pages[]` 取 label |
| `tools/verify/verify-os172-naming.mjs`（第 56、65 行） | 目录对 `row.tab`、manifest 名对 `row.tab` | 目录对 manifest 的页面名；manifest 名对目录名或页面名；**另加**「12 个工作台的 `pages[].label` 都等于自己的 `name`」 |

`namingRow()` 的列补齐循环里 `tab`／`panelLabel` 两列保留（`settings` 这类宿主页面还要用），只是模块行不再写值；表头注释同步说明「模块显示名的权威是 manifest」。

`test/naming.test.mjs`、`test/os172Naming.test.mjs` 的改法与上面同口径；`test/tabRegistry.test.mjs` 的「八个工作台页签顺序与显示名只来自 manifest」「词表映射原样保真」两条必须原样通过。

## 不做

- MCP 工具名、端点路径、库内目录名、日志模块名一个不动；不改任何 manifest。
- 不动 `/api/plugins` 的字段。

## 验收

- 机器门禁全绿（门禁仍是 29 项，编号不变）；`app.js` 行数不增；`git diff --check` 干净。
- 反证两则，都要贴输出后还原：(a) 把某个 manifest 的 `pages[].label` 改得与目录名不一致，S2.5 与 S2.9 都必须红；(b) 在表里某个模块行加回 `tab`，测试必须红。
- 监督线另核：`git diff public/views/registry.mjs` 里 `DIR_LABELS` 等派生表的取值逐键未变。
