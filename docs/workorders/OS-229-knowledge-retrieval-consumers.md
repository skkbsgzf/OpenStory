# OS-229 · API/MCP/Agent 统一检索主链

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-227、OS-228 |
| 允许改动 | `src/modules/knowledge-base/**`、`src/modules/knowledge/**`、`src/modules/knowledge-runtime/**`、`src/host/mcp.mjs`、`src/host/moduleHooks.mjs`、`src/services/systemPrompt.mjs`、`src/api/contracts/**`、`test/mcpDaemon.test.mjs`、`test/knowledge*.test.mjs`、`docs/mcp/**`、相关数字锚 |
| 风险 | 高——三消费通道同源 |
| 状态 | 待施工 |

## 目标

API、MCP、Agent 对同一知识库查询返回同源命中与来源，只有提示词装配层不同。

## 任务

1. `KnowledgeSearchService` 唯一实现：active/enabled/libraryId 解析、provider、stale、topK/minScore、总预算、去重、provenance、超时取消。
2. 统一 hit：libraryId/ref/title/text/score/source/hash/provenance/tags；不丢文档/chunk 身份。
3. API 页面搜索与 MCP list/search/read 共用服务；MCP 首版不开放 insert/sync 生产写。
4. Agent promptContext 改走同一服务：按 brief/genre/intent 生成查询，结果作为低优先级“参考资料”，总字符预算内注入；runtime down 时聊天继续但不注入假结果。
5. 现有 `/api/kb/config|status|test` 与 MCP 工具名保留；WeKnora 作为显式兼容 provider，不作为 HyperGraphRAG 的隐式 fallback。
6. 修 KB 短密钥掩码、坏配置覆盖、缓存不含 profile/index 版本等 P0/P1；错误码补 HTTP 映射。

## 验收

- 同一临时查询经 API/MCP/Agent 得到相同 hits/provenance；Agent 只多裁剪/封装。
- stale/down/未配置不返回假空结果；切换知识库后缓存立即失效。
- 短密钥不回显完整值；坏 kb-config 不被一次保存覆盖；日志无密钥。
- 全量测试、验收、数字锚、MCP 隔离测试全绿；不 push。
