# OS-205a · 批末返工：没开库时启停开关必须置灰

| 项 | 值 |
|---|---|
| 批次 | 第四批（段末返工）；总验收发现 |
| 依赖 | OS-201（治理台，`0952c8e`）、OS-204（`b2083d4`） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 低——一处状态传递；不新增端点、不动后端 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 为什么返工（监督线 2026-11-26 批末总验收发现）

规划 §3 裁定写明：「没开库时的启停——开关置灰并提示先开库；能力图与卡片照常可看」。这一条在真实页面上**没有生效**。

实测（真实 daemon，`state.current` 为 null）：治理台照常渲染 21 张卡与能力图，但 12 个工作台的开关**全部可点、没有 disabled**，页面只写了「21 件 · 未打开库」。

源码定位：

- `public/views/governanceViews.mjs:442` 的开关渲染是 `options.canToggle === false ? ' disabled title="先打开一个库——启停按库分别记"' : ''`；
- `:660` 传给卡片的是 `canToggle: opts.canToggle !== false`；
- `:715` 装配时写成 `canToggle: Boolean(state.current?.path)`。

问题在于三层 `opts` 都默认「没传就算 true」：`governanceHtml` 装配卡片时用的是外层 `opts`（`governanceHtml(view, options)` 的第二个参数），而真实页面调用 `governanceHtml()` 时**不传 options**，于是 `opts.canToggle` 是 `undefined`，`!== false` 为真 → 全部可点。第 715 行那个 `Boolean(state.current?.path)` 被忽略了。

OS-201 的探针没抓到，是因为它测的是 `governanceHtml({ ..., noLibrary: true })` 这种手工入参分支，而不是「`state.current === null`」这个真实条件。

## 任务

### 1. 修真实的判断来源

`public/views/governanceViews.mjs`：

- 「能不能启停」**只由 `state.current` 是否有库决定**，不依赖调用方传 `options`：`const canToggle = Boolean(state.current?.path)`，一路传到卡片渲染（不要再被 `opts.canToggle !== false` 覆盖）。
- 没开库时：工作台开关渲成 **`disabled` + `aria-disabled="true"` + `title="先打开一个库——启停按库分别记"`**；能力、依赖、指路、能力图**照常可看**（不隐藏、不空态）。
- 已开库时行为不变（可点、确认条、写回）。

### 2. 测试（必须能在"没修好"时红）

`test/governanceViews.test.mjs` 加例：

- 用**真实形状**的载荷（`state.plugins` 给完整 69 条）＋`state.current: null` 调 `governanceHtml({ state })`（**不传 options**）→ 断言 12 个工作台开关全部带 `disabled` 与 `aria-disabled="true"`，且 `title` 含「先打开一个库」。
- 同一载荷 + `state.current: { path: '/lib' }` → 开关不带 `disabled`。
- 页头仍写「未打开库」、卡片数与能力图节点数不变（21／21）。

现有那条 `noLibrary: true` 的用例保留（它是另一种空态入口），但**不能替代**上面这条真实条件用例。

## 不做

- 不改其它卡片、能力图、确认条、降级逻辑（均已验收）。
- 不动后端与 `setModuleEnabled`（它在没库时会抛 `NO_LIBRARY`，这条已经是对的）。

## 验收

- 机器门禁全绿；`app.js` 行数不增（当前 10,044）；`git diff --check` 干净。
- **浏览器实测必做**：不开库直接进设置 → 插件治理台，截图证明 12 个开关是灰的、卡片与能力图正常显示；再开一个库，截图证明开关可点。贴两张截图路径。
- 反证：把 `canToggle` 改回 `opts.canToggle !== false`，新用例必须红；贴输出后还原。
