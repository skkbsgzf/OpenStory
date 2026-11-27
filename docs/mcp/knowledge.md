# 独立知识库 MCP（OS-229）

独立知识库是跨项目的储备知识资产，不属于作品世界书。MCP 首版只开放只读消费：

| 工具 | 用途 |
|---|---|
| `openstory_knowledge_libraries` | 列出已登记知识库与 activeLibraryId；不返回源绝对路径或凭据 |
| `openstory_knowledge_search` | 统一检索，参数 `query/libraryId?/topK?/minScore?/budgetChars?` |
| `openstory_knowledge_read` | 按 `libraryId/documentRef` 读取源文档与反链 |

所有工具与 API、Agent 共用 `KnowledgeSearchService`，同查询返回同源 hits/provenance。MCP 不开放 `insert/sync` 生产写；登记、定制、索引同步只在知识库工作台经预览/确认执行。

## 边界

- HyperGraphRAG 未安装、停用、版本不符或索引 stale 时返回类型化错误；不静默降级到 WeKnora，也不返回假空 hits。
- 源目录只读；documentRef 必须是已登记库内相对 Markdown 路径，symlink/跨库/`..` 拒绝。
- 凭据仍只存本机 `kb-config.json`，不出现在清单、manifest、定制、日志、响应或种子包。
- 作品世界书继续由 reference 域工具消费；两者只是复用中性 wiki 呈现层，不共享数据语义。
