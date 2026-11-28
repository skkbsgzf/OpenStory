# 官方样板知识库体验缺口（乙批实测）

> 本文件是「放置 → 登记 → 索引 → 检索 → 阅读 → 问答」全链路跑通时逐条记录的卡点，作为下一轮框架升级输入。
> 演练在隔离临时 daemon＋临时 `LOCALAPPDATA` 中完成，未连接 8807、未碰作者真库。

## 已跑通

| 步骤 | 结果 |
|---|---|
| 放置 | `knowledge-packs/official-starter/` 五篇本体＋`knowledge.base.json` |
| 登记 | `POST /api/knowledge/library/preview` → 200，`documentCount=5`；`POST /api/knowledge/library/register` → 200，`id=official-starter` |
| 文档列表 | `GET /api/knowledge/documents` → 5 篇，refs 齐全 |
| 阅读 | `GET /api/knowledge/document` → 200，标题「古代官爵制度速查」、正文 1,775 字 |
| MCP 阅读 | `openstory_knowledge_read` → 返回同篇全文与 frontmatter 标签 |

## 缺口清单

```text
[缺口] 想用官方样板库跑检索问答 → /api/knowledge/search 返回 409 INDEX_NOT_READY；
        /api/knowledge/index/sync 返回 WRITE_PROTOCOL_IO_FAILED「未配置固定 HyperGraphRAG venv Python」
        → 建议：设置页「引擎与存储 · 本地 RAG」已给安装命令，本批按「无外部依赖」不代跑安装；
        下一轮若提供固定 venv，应把 OPENSTORY_HYPERGRAPH_PYTHON 作为验收前置项，并让 index/sync 的错误码更具体（priority 高）

[缺口] 十组检索夹具目前只能做结构核对（每篇应命中/不应命中各 ≥2），真实检索命中未能验证
        → 建议：provider 就位后逐条跑 tools/verify/verify-semantic-quality.mjs 的 query 清单，
        并把 official-starter 的 gold 查询纳入同一报告（priority 高）

[缺口] 知识库登记后 index-status 一直 stale，界面上缺少「去安装运行时」的一键跳转说明
        → 建议：在知识库页把 RUNTIME_MISSING/未配置 python 的提示接到设置页本地 RAG 区（priority 中）

[缺口] 文档只读体验已通，但检索结果片段要看上下文时需再调一次 document 端点
        → 建议：命中段落高亮＋跳转 documentRef（priority 中）
```

## 结论

乙批交付的是**文档本体与登记/阅读链路**：五篇已能被系统识别、登记、列举和读取；检索问答链路被本机缺少固定 HyperGraphRAG venv 阻断，按「无等待项」纪律不伪造通过，缺口如实入表。
