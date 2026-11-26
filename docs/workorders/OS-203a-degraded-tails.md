# OS-203a · 降级显形返工：右栏入口不许消失、设置区提示必须命中

| 项 | 值 |
|---|---|
| 批次 | 第四批（段内返工）；主单 [OS-203](OS-203-degraded-surfaces.md) |
| 依赖 | OS-203（`1077313`） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中——两处渲染条件；不新增端点、不动后端 |
| 状态 | 待派 |

通用规则见 [`COMMON_RULES.md`](COMMON_RULES.md)。

## 为什么返工（监督线 2026-11-26 浏览器实测＋源码核对）

已好的部分（不返工）：降级页签灰显＋`aria-disabled`＋悬停说明；点降级页签被拦住；深链强制进入给说明页（「扮演 · 暂不可用／缺少所需能力：text.analyze@1（供给方：文本内核）／去插件治理台 →」）；`slotState`、`missingText`、`degradedViewHtml` 都在且正确；`app.js` 里已无 `slotHas(`。

两处没做到：

### 1. 右栏入口在降级时被隐藏，而不是灰显

浏览器实测：把 `analysis` 停用、`text` 停用、`analysis` 重开（造出降级）后，正文页的「分析本章」按钮 `hidden="true"`、**完全消失**。

- 源码：`public/app.js:1968` 的按钮用 `slotAction('right', 'analysis', '分析本章')` 生成属性；这个 helper 在「不在投影里」时直接给 `hidden`，而降级件**在**投影里但需要的是「灰显＋不可点＋带 title」。
- 工单原文要求：「停用照旧隐藏；降级则置灰保留并带同样的 `title`」。现在把「降级」也当成了「隐藏」。

### 2. 设置区降级提示没生效，仍出完整可编辑表单

浏览器实测：`imagegen` 降级时，「引擎与存储」里生图、识图两块仍是完整表单（Endpoint／模型／Key／保存／测试连接全在），没有出降级说明。

- 源码：`public/views/settingsViews.mjs` 确实有 `degradedNoticeHtml(id)` / `degradedCardHtml(id, healthy)`，也套在了生图（第 240、290 行）与知识库（第 590 行）上，但实测没命中——说明它判定的数据源与实际 `state.plugins` 的字段对不上（`status`／`modules` 取法有问题），或 `moduleOn()` 那一层先把它挡掉了。
- 结果：用户看到一份能改但改了不生效的表单——正是 OS-146 铁律（「界面上出现的每个设置项必须有真实消费者」）禁止的那种死配置。

## 任务

### 1. 右栏入口：停用隐藏、降级灰显

`public/app.js`：

- `slotAction(slot, page, label)`（或等价 helper）改成三态：
  - 不在投影里（停用）→ `hidden`（保持现状）；
  - 在投影里且 `degraded` → **可见、`disabled`、`aria-disabled="true"`、`title` 用 `missingText(...)`**（经注入，不许在 app.js 里新写一份文案）；
  - 在投影里且健康 → 现状不变。
- 同样的三态处理另外三处：`analysisOn`、推演「生图」按钮、顶栏「导入/导出」按钮。**降级一律可见但置灰**，不许再出现「降级即消失」。

### 2. 设置区：提示必须真的命中

`public/views/settingsViews.mjs`：

- 修 `degradedNoticeHtml(id)` 的数据源：从注入的「模块状态」取（`state.plugins.modules` 里该 id 的 `status`／`missing`／`requires`），而不是从 ui-state 或别的影子字段推断。
- 生图、识图、知识库三块在降级时必须：**不出可编辑表单／不出保存与测试按钮**，只出一条说明（模块名、缺什么、谁该供给、去插件治理台或引擎设置的指引）。
- 判定函数保持纯、可测：把「给定 payload＋id → 是否降级、出什么说明」抽成具名导出（如 `settingsCardState(payload, id)`），供 Node 测试直接调。

### 3. 测试（必须能在「没修好」时红）

`test/degradedSurfaces.test.mjs` 加例：

- **右栏三态**：构造「不在投影」「在投影但 degraded」「健康」三种 slots＋modules 夹具，断言 helper 输出分别是 `hidden`／`disabled`＋`aria-disabled`＋`title` 含能力 id／无隐藏无禁用。
- **设置区命中**：给一份 `imagegen` 降级的 payload，断言生图／识图两块**不含** `id="mcfg-image-endpoint"`、`data-action="config-save"`、`data-probe-kind="image"`，且含降级说明与能力 id；知识库同理；健康 payload 下三块表单照常。
- **纯函数**：`settingsCardState()` 对健康／降级／停用三态各一条。

## 不做

- 不改降级页签、说明页、`slotState`、`missingText`（这些已验收）。
- 不动后端、不改 `moduleOn` 的启停语义（启停仍只看 ui-state）。

## 验收

- 机器门禁全绿；`app.js` 行数不增（当前 10,095）；`git diff --check` 干净。
- **浏览器实测必做**（这是缺陷的发现方式）：造出降级后——(a) 正文页「分析本章」按钮可见但灰显且悬停有说明；(b) 「引擎与存储」里生图／识图不再是可编辑表单、出降级说明。两条各贴一张截图与 DOM 断言（`disabled`／无 `config-save`）。
- 反证：把 `slotAction` 的降级分支改回 `hidden`，右栏三态测试必须红；把 `degradedNoticeHtml` 改回空串，设置区用例必须红。贴输出后还原。
