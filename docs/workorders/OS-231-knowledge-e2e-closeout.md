# OS-231 · 知识库浏览器/API/MCP E2E 与总收口

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C 收口 |
| 执行 | workflow 施工；hy4flash；dsv4flash 评审 |
| 依赖 | OS-230 |
| 允许改动 | `test/helpers/pageMatrix.mjs`、`test/helpers/tempDaemon.mjs`、`test/knowledge*.test.mjs`、`test/mcpDaemon.test.mjs`、`tools/verify/**`、`.github/workflows/ci.yml`、`tools/acceptance/**`、`docs/ACCEPTANCE.md`、`docs/PUBLISHING.md`、`docs/mcp/**`、`AGENTS.md`、`README.md`、`ARCHITECTURE.md`、`docs/number-anchors.json` |
| 风险 | 高——全链路总验收 |
| 状态 | 待施工 |

## 目标

证明知识库插件在真实浏览器、真实 HTTP 与 MCP 三通道都可用，并完成 OS-211～231 总收口。

## 任务

1. 页面矩阵补：知识库主页、空库、文档列表/标签、详情、反链、图谱、搜索有/无结果、stale、runtime down、登记预览确认、启停、active 切换、定制、索引状态、管理模块停用。
2. 关键页面补 675px/420px；图谱与详情窄屏必须验证；截图/错误/请求/溢出门禁沿用第五批。
3. tempDaemon fixture 增两份临时知识库与假 sidecar；不依赖真实 Python/模型/8807。
4. API/MCP/Agent 同源 E2E；凭据、路径、symlink、跨库 ref、stale/down 负向。
5. CI 增知识库 E2E 与真实 HyperGraphRAG 独立门禁（可下载报告）；文档/数字锚/架构/总验收记录/交接。

## 验收

- 所有新增页面真实 Chromium 通过，报告无 fail/manual/skip，截图齐全非空。
- 三通道同源、运行时降级、密钥与路径安全测试全绿。
- 全量测试两轮、29+ 验收、arch、number anchors、CI 结构、MCP 构建 E2E、迁移 E2E、HyperGraphRAG 真实评测、完整 browser smoke 全绿。
- 不 push、不 tag；版本 0.2.0、依赖不动、app.js 不增。
