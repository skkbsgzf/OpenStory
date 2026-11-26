# 页面可视测试与后端必要功能测试批（第五批）

> 作者 2026-11-26 要求：「每个页面需要有对应的前端可视测试，以及后端必要功能的测试。」
> **作者同日裁定：第五批不外发施工，由监督线独立完成。** 仍按 OS-206～210 逐张施工、逐张验收；只提交，不 push。
> 监督线盘点后确认：现有测试强在纯视图金样与 daemon 业务链，弱在真实浏览器装配/交互、页面覆盖矩阵、报告失败门禁与 MCP 隔离集成。
> 本批零新增 npm 依赖、零构建；全部测试使用临时库、临时 `LOCALAPPDATA`、`port:0` 临时 daemon；不连接/重启 8807。

## 1. 目标

1. 每个用户可见页面与主要页内视图都有**真实 Chromium** 的 DOM／布局／状态断言和截图。
2. 每个页面依赖的后端 API 都有真实 HTTP 契约与业务状态验证。
3. 关键写入、配置、恢复、模块治理、迁移、MCP 数据工具都有成功与负向矩阵。
4. 测试报告完整性可机器判定：缺页、fail、manual、缺图、空图都不得通过。
5. CI 同时运行 Node 门禁、隔离 e2e 与独立浏览器 smoke job。

## 2. 方案边界

- 浏览器测试用 Node 内置 `WebSocket` 直连 CDP，不引入 Playwright/Puppeteer/jsdom。
- 可视通过条件＝元素可见、尺寸非零、无脚本错误、无意外 HTTP 错误、无横向溢出、ARIA/状态正确、截图存在；**不做像素基线 diff**。
- 页面矩阵从 `/api/plugins.slots`、`TAB_REGISTRY`、`SETTINGS_NAV` 派生，不手抄第二份页面名单。
- 后端范围＝页面必需 API＋所有关键写入/治理/MCP；不为 108 个端点机械复制无意义的最小请求。

## 3. 工单

| 序 | 工单 | 内容 | 依赖 |
|---|---|---|---|
| 1 | [OS-206](../workorders/OS-206-test-harness-matrix.md) | 共享临时 daemon fixture、页面矩阵、零依赖 CDP 客户端、浏览器 smoke 入口与报告 schema | 无 |
| 2 | [OS-207](../workorders/OS-207-browser-page-tests.md) | 全页面真实可视测试、页内视图、弹层、窄屏、iframe、截图与错误门禁 | OS-206 |
| 3 | [OS-208](../workorders/OS-208-page-api-tests.md) | 页面必需 API 真实 HTTP 测试，补日志/草稿/Agent/任务/偏好/KB 缺口 | OS-206 |
| 4 | [OS-209](../workorders/OS-209-write-governance-mcp-tests.md) | 写入/治理/恢复/迁移/41 模块端点停用恢复/MCP 隔离数据工具矩阵 | OS-206～208 |
| 5 | [OS-210](../workorders/OS-210-ci-report-docs.md) | CI 隔离 e2e＋browser job、报告完整性门禁、文档与数字锚收口 | OS-207～209 |

## 4. 出口条件

1. 页面矩阵覆盖所有顶层页、七设置分区与主要页内视图，缺一页即红。
2. 浏览器 smoke 全部页面通过，manifest 无 fail/manual，截图齐全非空。
3. 页面必需 API 与关键写入/治理/MCP 测试全绿，负向与幂等有明确断言。
4. CI 两个 job（gates/browser-smoke）全绿，失败产物可下载。
5. 既有测试只增不减，门禁只增不减，`app.js` 不增，端点与 MCP 外部名不变。
6. 8807、作者真库、真实 `%LOCALAPPDATA%` 全程未动。
