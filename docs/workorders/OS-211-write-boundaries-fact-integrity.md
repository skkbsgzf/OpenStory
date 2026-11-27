# OS-211 · 写边界与 fact 完整性修正

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；规划见 [`mcp-build-upgrade-knowledge-20261126.md`](../plan/mcp-build-upgrade-knowledge-20261126.md) |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | 无 |
| 允许改动 | `src/modules/chapters/**`、`src/modules/worldbook/**`、`src/modules/prose/**`、`src/modules/fact/**`、`src/services/syncCheck.mjs`、`src/api/contracts/**`、`src/api/handlers/**`、`src/host/mcp.mjs`（仅世界书写工具调用方）、`public/app.js`（仅世界书写入调用方，净行数不增）、`public/views/workbenchViews.mjs`（仅新增世界书/正文写入路由选择的纯函数，监督线 2026-11-27 批准）、`test/**`、`tools/acceptance/**`、对应文档与数字锚 |
| 风险 | 高——写安全与数据契约 |
| 状态 | 待施工 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

在 MCP-only 建样例前堵住通用文本写通道绕过 fact 协议的问题，并让 fact/wiki 派生版本可被真实检查。

## 任务

1. **正文/剧本写边界**：`chapterPut` 只允许其所属载体目录（正文、剧本等明确集合）；`故事源/`、`.openstory/`、任意非载体路径拒绝。不要只修 MCP，直接 HTTP 也必须安全。
2. **世界书专用写端点**：新增受 `worldbook` manifest 端点归属约束的写接口；MCP 世界书写入改走该接口；复用现有 `prose.writeChapterWithBackup`，不复制写实现。
3. **fact patch 校验**：`writeFactFile` 的 `patch.entries` 整份替换前逐条调用 `validateFactEntry`；任一 errors 整体拒绝，零写入。
4. **fact/wiki revision 对齐**：修正 `writeFactEntries` 与 `writeFactFile` 的 wiki 派生基准，确保成功写入后 `derivedFrom.factRevision === document.revision`；提供幂等与失败语义。
5. **syncCheck**：`checkSameSource` 真正消费 `wikiDerivedFrom.factRevision`，两者可信且不等时 `wikiStale=true`；时间戳保留作辅助诊断。
6. **契约/文档/测试同步**：新增端点契约、模块归属、错误码与 HTTP 映射；补反证：通用章节端点写 fact 被拒、世界书模块停用写被拒、非法 patch.entries 零写入、revision 不一致报 stale。

## 验收

- 新写边界在真实 daemon HTTP 与 MCP 两条路径生效。
- fact 单条与 patch.entries 都经过同一 schema 校验；旧合法数据不受影响。
- 新样本构建前，7 条旧 fact 的问题有明确修复路径；本单不直接手改 samples。
- 世界书现有写、生图回填、absorb 与日志恢复不回退。
- 全量测试、验收、arch、数字锚全绿；不 push。
