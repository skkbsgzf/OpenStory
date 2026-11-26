# OS-207 · 每个页面的真实可视测试

| 项 | 值 |
|---|---|
| 批次 | 第五批第 2 张；规划见 [`page-testing-batch-20261126.md`](../plan/page-testing-batch-20261126.md) |
| 执行 | **监督线独立施工** |
| 依赖 | OS-206 |
| 允许改动 | `test/**`、`tools/verify/**`、`public/**`（仅暴露必要测试语义/修 bug）、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/number-anchors.json` |
| 风险 | 高——覆盖全页面与真实浏览器交互 |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

用 OS-206 的 CDP 基建，对每个页面与主要页内视图执行真实浏览器测试。通过条件：关键区域可见且非零、无脚本错误、无意外 HTTP 错误、无横向溢出、状态/ARIA 正确、截图存在；不做像素 diff。

## 页面范围

1. 宿主：库管理、新建库、导入、修复。
2. 八个工作台页：产物、正文、世界书、剧本、日志、故事源、习惯、扮演。
3. 设置七分区：外观、引擎与存储、关于、插件治理台、面板、全部套件、本机模块。
4. 页内视图：世界书图谱/笔记/词条；故事源大纲/表格/图表；扮演叙事流/剧情树/Agent/开局向导；正文分析抽屉与左栏。
5. 弹层：增加页签、本章、剧本设置、导入导出、新建世界书笔记/标签、日志 diff/恢复。
6. 特殊：没开库的治理台；第三方 iframe 页面；降级页签/设置区/说明页。

## 固定断言

- `document.title` 正确；主区域与页面标记存在；
- 主区域 `getBoundingClientRect()` 宽高 > 0；
- `document.documentElement.scrollWidth <= clientWidth + 1`（允许明确登记的水平滚动容器）；
- 无 `console.error`、`Runtime.exceptionThrown`、unhandled rejection；
- 无意外 HTTP 4xx/5xx（允许矩阵显式登记的业务错误用例）；
- 关键 `disabled/aria-disabled/aria-expanded/aria-checked` 与预期一致；
- 截图 PNG 存在且 > 1KB；
- 1500×980 主视口；治理台/正文/世界书/剧本/扮演/设置补 675px 与 420px；
- 页面切换后旧库内容不残留。

## 实施

- 扩 `test/helpers/pageMatrix.mjs` 的 setup/actions/assertions；
- 在 `tools/verify/page-browser-smoke.mjs` 实现通用 navigate/click/wait/assert/report；
- 对无法纯 CDP 表达的原生 confirm/file chooser，采用页面内显式测试钩子或自动 dismiss，并登记；
- 需要产品代码配合时只做最小 `data-testid`/可访问名称/稳定 DOM 标记，禁止为测试改业务行为；
- 截图与 manifest 写独立输出目录，失败步骤也留图与错误；
- 报告不得把 skip/manual 算通过。

## 测试

- `test/pageMatrix.test.mjs` 继续验证覆盖完整；
- 新增 `test/browserSmokeArtifacts.test.mjs` 验证 manifest schema、截图非空、fail/manual/缺图反证；
- 全量 `npm test` 与 acceptance 全绿；
- 独立跑 `node tools/verify/page-browser-smoke.mjs --out <临时目录>`，所有页面通过。

## 不做

- 不做像素基线；不引 npm 浏览器框架；不连 8807；不写真实库。

## 验收

- 页面矩阵每一页都有一次真实浏览器执行记录与截图；
- manifest 无 fail/manual，错误列表为空；
- 反证：让一个页面不渲染、制造横向溢出、去掉一张截图、注入 pageerror，入口必须红；
- `app.js` 不增。
