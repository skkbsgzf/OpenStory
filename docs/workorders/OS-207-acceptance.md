# OS-207 验收记录（监督线独立施工，2026-11-26）

**结论：通过。** 34 个真实 Chromium 场景全绿，报告完整性校验通过。

## 交付

- 扩 `test/helpers/pageMatrix.mjs` 至 34 项：28 基础页/视图/弹层＋6 关键场景（没开库治理台、能力图点选、停用确认、降级页签、降级说明页、第三方 iframe）。
- `tools/verify/page-browser-smoke.mjs` 支持页面级 HTTP 前置/恢复、通用表达式断言、动作后断言、预期业务错误白名单、自动进库、本机模块夹具、origin 留档。
- `test/helpers/tempDaemon.mjs` 支持临时本机 iframe 模块根；全部路径与 LOCALAPPDATA 隔离。
- `verify-page-report.mjs` 与 smoke 使用同一预期错误口径。

## 实测

- 基础矩阵：28/28。
- 扩展矩阵：**34/34**；47 个 viewport 记录（1500×980、675×900、420×800）。
- 截图：34 张，全部 >1KB。
- `verify-page-report.mjs`：34 页全通过、截图齐全、无脚本错误。
- 全量 908 例／906 过／2 跳过／0 挂；验收 29/0/0；arch check、number anchors 全绿。
- 8807 未动。

## 关键断言证据

- 没开库：12 个工作台开关全部 `disabled`，title 为「先打开一个库——启停按库分别记」。
- 能力图点 fact：14 条 hot 边，fact 卡展开并显示连锁影响。
- 停用扮演：确认条含「页签『扮演』从导航消失」「库内数据与配置全部保留」与取消按钮。
- 降级：页签 `tab-degraded`／`aria-disabled`／title 含 `text.analyze`；直达视图显示说明与治理台入口。
- 第三方 iframe：临时模块根登记后投影出 iframe 页，标题条与 `/module-page/page-test-ext/page.html` 入口正确。

## 反证

- `console.error` 注入被 CDP 捕获（1 条）。
- 报告 fail/manual/缺图/空图/脚本错误由 OS-206 测试逐项反证。
- 降级场景的 503 只在矩阵显式登记的业务错误白名单内放行；恢复 ui-state 后后续页面无 503。

## 限制

- 未做像素基线 diff（按计划明确不做）。
- 未接 CI（OS-210）。
