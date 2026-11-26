# OS-206 · 页面测试基建与覆盖矩阵

| 项 | 值 |
|---|---|
| 批次 | 第五批第 1 张；规划见 [`page-testing-batch-20261126.md`](../plan/page-testing-batch-20261126.md) |
| 执行 | **监督线独立施工**（作者 2026-11-26 裁定：第五批不外发） |
| 依赖 | 无 |
| 允许改动 | `test/**`、`tools/**`、`package.json`（只可新增 scripts）、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`design-system/**`、`.github/workflows/ci.yml`、`docs/number-anchors.json` |
| 风险 | 中——新基建，后续四张单都依赖其形状 |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

建立零新增 npm 依赖、零构建的页面测试基建：共享临时 daemon fixture、从现有真源派生的页面矩阵、Node 内置 WebSocket 的 CDP 客户端、浏览器 smoke 入口与机器可判定的 manifest。

## 任务

### 1. `test/helpers/tempDaemon.mjs`

导出 `makeTestLibrary` / `withTempDaemon` / `withBrowserFixture`：

- `mkdtemp` 建 base；复制 `samples/水浒传` 到临时库；
- 注入 `LOCALAPPDATA/APPDATA`，写临时 `libraries.json`、`.openstory/ui-state.json`；
- `startDaemon({ port: 0 })`，返回 `origin/root/base/daemon`；
- 可选假上游与 `agentConfigPath`（复用 `tools/verify/verify-os172-e2e.mjs` 的做法）；
- `finally` 关 daemon、关上游、递归删 base；
- 提供清理页签/模块隐藏状态的选项，但绝不动样例原仓。

### 2. `test/helpers/pageMatrix.mjs`

定义页面矩阵 schema，并从现有真源派生：

- 工作台页：`/api/plugins.slots`＋`TAB_REGISTRY`；
- 宿主页：`TAB_REGISTRY` 的 `libraries/lib-create/lib-import/repair/settings`；
- 设置分区：`SETTINGS_NAV` 七项；
- 页内视图：世界书图谱/笔记/词条，故事源大纲/表格/图表，扮演叙事流/剧情树/Agent/开局向导，分析抽屉；
- 弹层：增加页签、本章、剧本设置、导入导出、新建笔记、日志 diff；
- 第三方 iframe：临时本机模块夹具。

每项字段：`id/view/scope/title/entry/requiredApi/domSelectors/allowedStates/screenshot/setup/actions`。导出 `validatePageMatrix(matrix, { slots, registry, settingsNav })`，缺页、重复 id、未知 view、缺截图名、缺 DOM 断言一律抛错。

### 3. `tools/verify/cdp-browser.mjs`

零依赖 CDP 客户端：

- 支持 `CHROMIUM_PATH` / `CHROME_PATH` / Edge 候选；找不到明确报错；
- `--headless=new --remote-debugging-port=0 --user-data-dir=<临时>` 启动；
- Node 内置 `WebSocket` 连接 `/json/version` 暴露的 browser WS；
- `Target.createTarget` / `Page.navigate` / `Page.captureScreenshot` / `Runtime.evaluate` / `Input.dispatchMouseEvent` / `Emulation.setDeviceMetricsOverride`；
- 收集 `Runtime.consoleAPICalled`（error）、`Runtime.exceptionThrown`、`Log.entryAdded`、请求失败；
- 超时、页面关闭、浏览器退出、临时目录清理。

### 4. `tools/verify/page-browser-smoke.mjs`

- 启动临时 fixture daemon（import `test/helpers/tempDaemon.mjs`）；
- 读取矩阵逐页导航/动作/断言；
- 输出 `manifest.json`、PNG、`console-errors.json`；
- `--out <目录>`；缺页、fail、manual、缺图、空图、脚本错误、横向溢出都非零退出。

### 5. `test/pageMatrix.test.mjs`

- 矩阵覆盖所有 `TAB_REGISTRY` 顶层页、七设置分区和登记的页内视图；
- 重复/未知/缺字段反证；
- fixture 不碰真实路径，daemon 只监听回环；
- CDP 客户端源码无第三方 import。

## 不做

- 本单不实现所有页面动作，只完成基建与最小一条页面 smoke（库管理或正文）证明链路通。
- 不接 CI（OS-210）。

## 验收

- `test/pageMatrix.test.mjs` 全绿；基建源码 `node --check` 全过；
- 最小浏览器 smoke 真实启动 Chromium＋临时 daemon，产出一张非空截图与合法 manifest；
- 反证：删一个矩阵页 / 把截图写成空文件 / 注入 console.error，入口必须红；
- `app.js` 不增，端点 108 不变。
