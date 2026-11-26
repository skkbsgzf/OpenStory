# OS-210 · CI、报告完整性与文档收口

| 项 | 值 |
|---|---|
| 批次 | 第五批第 5 张；规划见 [`page-testing-batch-20261126.md`](../plan/page-testing-batch-20261126.md) |
| 执行 | **监督线独立施工** |
| 依赖 | OS-207～209 |
| 允许改动 | `.github/workflows/ci.yml`、`tools/**`、`test/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/number-anchors.json` |
| 风险 | 中——CI 与门禁结构 |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

把测试体系接入 CI，并让报告完整性成为硬门禁；纠正过时文档。

## 任务

1. `.github/workflows/ci.yml`：
   - `gates` job 增加 `node tools/verify/verify-os172-e2e.mjs`；
   - 独立 `browser-smoke` job：Ubuntu、固定 Chromium、Node 24、运行 `page-browser-smoke.mjs`；
   - 上传 manifest、截图、console/pageerror 日志；
   - 失败注解与 job summary 保留。
2. `tools/verify/verify-ci-workflow.mjs`：更新步骤结构校验。
3. 新增 `tools/verify/verify-page-report.mjs`：
   - 页面集合等于矩阵；
   - 无 fail/manual/skip；
   - 截图存在且非空；
   - manifest schema、错误列表、横向溢出断言完整；
   - 任一不满足非零退出。
4. 文档：
   - `docs/ACCEPTANCE.md:38-39` 与 `AGENTS.md` 中“e2e 依赖 8807/作者夹具、不进 CI”的过时表述改为当前隔离事实；
   - `docs/PUBLISHING.md`、README 记录三层门禁与命令；
   - 数字锚与架构统计回写。

## 验收

- CI workflow 结构校验全绿；
- 本地等价跑 gates＋隔离 e2e＋browser smoke＋report 校验全绿；
- 反证：删页面、造 fail/manual、删截图、空截图、让 CI 缺少 browser job，校验必须红；
- 不 push；端点/MCP 名不变，`app.js` 不增。
