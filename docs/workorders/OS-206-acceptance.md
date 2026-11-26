# OS-206 验收记录（监督线独立施工，2026-11-26）

**结论：通过。** 零新增 npm 依赖、零构建。

## 交付

- `test/helpers/tempDaemon.mjs`：共享临时库/daemon/假上游生命周期；`port:0`；临时 `LOCALAPPDATA/APPDATA`；复制 `samples/水浒传`；`finally` 清理。
- `test/helpers/pageMatrix.mjs`：28 项矩阵，从 `TAB_REGISTRY`、`SETTINGS_NAV` 与投影校验派生；覆盖宿主页、八工作台、七设置分区、页内视图与弹层。
- `tools/verify/cdp-browser.mjs`：Node 内置 WebSocket＋CDP；独立 headless Edge/Chromium；导航、点击、输入、viewport、截图、console/pageerror/请求错误收集；临时 profile 清理。
- `tools/verify/page-browser-smoke.mjs`：逐页执行动作/DOM/尺寸/溢出断言，输出 manifest/PNG/log；失败即非零退出。
- `tools/verify/verify-page-report.mjs`：缺页、fail、manual、缺图、空图、脚本错误、溢出、汇总不一致均拒绝。
- `test/pageMatrix.test.mjs` 5 例；`test/browserSmokeArtifacts.test.mjs` 1 组反证。

## 实测

- `node --test test/pageMatrix.test.mjs test/browserSmokeArtifacts.test.mjs`：6/6。
- 全量：908 例／906 过／2 跳过／0 挂。
- 验收：29/0/0；arch check、number anchors 全绿。
- `node tools/verify/page-browser-smoke.mjs --page libraries`：真实 Edge＋临时 daemon，库管理页通过；截图 276KB；manifest 记录主区 1180×884、无溢出、无脚本错误。
- `verify-page-report.mjs` 对该产物通过；单页调试显示 1 页，不带 `--page` 时强制 28 页完整。
- 8807 未动，真库清单仍为空。

## 反证

- 矩阵重复 id、未知 view、缺 DOM/截图/viewport、缺投影页：均红。
- 报告 fail、manual、缺页、缺图、空图、pageerror：均红。
- 删除 `data-gov-action` 等既有门禁继续有效。

## 限制

- 本单只跑通库管理一页；其余 27 页由 OS-207 补齐。
- 未接 CI（OS-210）。
