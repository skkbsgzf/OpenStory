# OS-205 验收记录（监督线，2026-11-26）

**结论：通过（一轮过）。** 提交 `8af8062`。施工 CodeBuddy `hy4flash`。第四批最后一张。

## 一、我自己实跑

| 项 | 结果 |
|---|---|
| 独立探针 | **19 过 / 0 挂** |
| 全量测试 | 900 例 · 898 过 · 0 挂 · 2 跳过 |
| 验收门禁 | 29 过 / 0 挂 / 0 警 |
| `app.js` 行数 | 10,044（未增） |
| 端点数 | 108（未变） |
| manifest | **零改动**（`git diff b2083d4 8af8062 -- src/modules/` 为空） |

## 二、验收项

**命名表退掉模块页签列**：12 个模块（chapters/worldbook/script/storysource/roleplay/habits/log/artifacts/analysis/imagegen/knowledge/exchange）的 `tab` 与 `panelLabel` 全部为 `null`；宿主页面 `settings` 仍保留 `tab: '设置'`。目录列、日志模块列、`DIR_LABELS`、`LOG_MODULES` 取值逐键未变。

**前端不再有第二份模块名**：`public/**` 全扫，没有模块概念的 `namingEntry(...).tab` 用法（只有宿主 `settings` 那一处，工单允许）。

**三名一致改由 manifest 对照**：12 个工作台的「页面名＝模块名＝目录名＝日志模块名」全部成立。

**门禁与测试改指 manifest**：S2.5 不再拿 `row.tab` 对照页面名，新增「页面名＝`manifest.name`」与「模块行不许有 `tab`/`panelLabel`」两条断言；S4.1 核心页签名改从 `MODULE_MANIFESTS` 的 `pages[]` 取；`auditNamingConsistency` 改成「模块概念对 manifest 页面名，`tab` 只作非模块概念（`libraryStorage`、`uiState` 等无 manifest 页面的家伙）的回落」，并新增「12 个工作台 `pages[].label` ＝ 自身 `name`」。

## 三、反证（两条都成立，门禁强度未降）

**(a) 改一个 manifest 页面名**（`worldbook` 的 `pages[0].label` 改成「错名」）：
- S2.5 红：`页签层/命名表/日志层有名字没走真源：worldbook:worldbook`
- S2.9 红：`worldbook: 目录与 manifest 页面名/入口名不一致；模块显示名不一致；pages[].label「错名」≠ manifest name「世界书」`
- 门禁 26 过 / 3 挂。已还原。

**(b) 表里加回模块 `tab`**（`worldbook` 行加 `tab: '世界书'`）：
- S2.5 红：`命名表 worldbook 仍存 tab/panelLabel 模块页签名`（模块行 tab 残留 1）
- 单测 `test/naming.test.mjs` 1 挂。已还原。

## 四、测试改写说明（等价加强）

`test/naming.test.mjs` 与 `test/os172Naming.test.mjs` 的标题与断言按「表不再存模块页签名、改对 manifest」改写；被替换的断言全部换成**更严**的对照（manifest 页面名 ＋ 目录名 ＋ 新增「表里不许有模块 tab」），没有一处放宽或删除覆盖。`test/tabRegistry.test.mjs` 的两条原样通过。
