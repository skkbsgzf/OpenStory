# OS-210 验收记录（监督线独立施工，2026-11-26）

**结论：通过。** 三层隔离门禁接入 CI，页面报告完整性升级为硬门禁，过时 E2E 文档已纠正。

## 交付

- `.github/workflows/ci.yml`
  - `gates`：Node 24、两轮单测、验收、架构核对、隔离全栈 E2E；失败注解与日志 artifact。
  - 独立 `browser-smoke`：Ubuntu、系统 Chromium、Node 24、完整页面矩阵；报告校验失败也令步骤失败；manifest、run.log、console/pageerror 记录与截图统一上传，保留 7 天。
- `tools/verify/verify-ci-workflow.mjs`：YAML 子集结构校验扩为三层门禁；缺隔离 E2E、缺浏览器 job、CI 用 `--page` 跑残页、缺报告校验/产物均拒绝。
- `tools/verify/verify-page-report.mjs`：页面集合精确等于矩阵、去重、无 fail/manual/skip、截图路径不得越界、文件必须为非空 PNG、数组证据字段齐全、汇总含 skipped/unexpectedRequests。
- `tools/verify/page-browser-smoke.mjs`：补 skipped/unexpectedRequests 汇总；每个视口重置错误收集；页面结束留事件回合，避免上一页迟到错误污染下一页；末视口关键交互与截图语义不变。
- `test/browserSmokeArtifacts.test.mjs`：原反证全部保留，新增 skip、非 PNG、路径越界、CI 结构反证。
- `tools/number-anchors.mjs`：`docs/ACCEPTANCE.md`、`docs/PUBLISHING.md`、`docs/LEGACY-ITEMS.md` 转入当前实测锚；其余明确历史快照文档仍冻结。
- 文档：README、AGENTS、ACCEPTANCE、PUBLISHING 与遗留台账同步三层门禁；删除已完成的「无自动化 UI 测试」挂账。

## 实测

- 全量：930 例／928 过／2 跳过／0 挂。
- 验收：29/0/0；arch check、number anchors、CI workflow 结构校验全绿。
- 隔离全栈 E2E：水浒 10/10＋新建/半成品 13/13，临时假上游 1 次请求。
- 页面浏览器：34/34；47 个 viewport 记录；34 张截图；unexpectedRequests=0；报告校验通过。
- 反证：fail、manual、skip、缺页、缺图、空图、非 PNG、路径越界、pageerror 均非零退出。
- 8807 未连接、未重启；作者真库与真实 `%LOCALAPPDATA%` 未触碰。

## 边界

- 未 push、未 tag；版本仍 0.2.0，`package.json` 未改。
- 端点与 MCP 工具名不变；`app.js` 仍 10,044 行。
