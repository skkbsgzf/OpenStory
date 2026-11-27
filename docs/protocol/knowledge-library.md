# 知识库与检索契约（阶段 C）

> OS-225～231 的磁盘与能力契约。作者 2026-11-27 已批准按 plan 直接施工；不再使用 workflow。

## 1. 机器级知识库清单

路径：`%LOCALAPPDATA%/OpenStory/openstory/knowledge-libraries.json`（只从 `courtyardPath()` 推导）。

```json
{
  "schema": "openstory.knowledge-library@1",
  "schemaVersion": 1,
  "activeLibraryId": "seed-xiuxian",
  "libraries": [
    {
      "id": "seed-xiuxian",
      "name": "修仙种子包",
      "description": "公开许可的修仙术语示例",
      "source": "seed",
      "root": "D:\\Knowledge\\xiuxian",
      "realRoot": "D:\\Knowledge\\xiuxian",
      "manifest": "knowledge.base.json",
      "manifestSha256": "<sha256>",
      "contentRevision": "<sha256>",
      "enabled": true,
      "createdAt": "<iso>",
      "updatedAt": "<iso>",
      "customization": {
        "displayName": "修仙",
        "description": "",
        "tags": [],
        "nodeMap": {},
        "edgeMap": {},
        "exclude": [],
        "retrieval": { "topK": 6, "minScore": 0.3, "budgetChars": 6000 }
      },
      "index": {
        "status": "never-indexed",
        "contentRevision": null,
        "indexHash": null,
        "runtimeVersion": null,
        "builtAt": null,
        "error": null
      }
    }
  ]
}
```

约束：

- `id` 是稳定 slug；`root` 保留登记输入，`realRoot` 是 realpath 归一结果。
- `enabled=false` 保留数据、定制与索引元数据，但不允许检索/读取/同步。
- `activeLibraryId` 只能是已登记且 enabled 的库，或 `null`；切换与停用必须原子维护该不变量。
- 清单不存正文、凭据、请求头或 provider 原始错误。
- 作品模块开关仍在库内 `ui-state`；知识库资产状态不写入作品或 `suite-state`。
- 写前快照：`openstory/knowledge/history/<operationId>/knowledge-libraries.before.json`。
- 元数据日志：`openstory/knowledge/log/<yyyy-mm>.jsonl`，只记 id/ref/hash/revision/op/actor/time。

## 2. 单库 manifest

文件：知识库源根下的 `knowledge.base.json`，源文件只读。

```json
{
  "schema": "openstory.knowledge-base@1",
  "schemaVersion": 1,
  "id": "xiuxian",
  "name": "修仙知识库",
  "version": "1.0.0",
  "vendor": "OpenStory",
  "license": "CC-BY-4.0",
  "documentEntry": "docs/index.md",
  "formats": [".md", ".markdown"],
  "exclude": ["drafts/**", ".git/**", "node_modules/**"],
  "retrievalDefaults": { "topK": 6, "minScore": 0.3, "budgetChars": 6000 },
  "tagMap": {},
  "nodeMap": {},
  "edgeMap": {}
}
```

拒绝未知 schema、非法版本/许可、重复 id、绝对路径/盘符/`..`/空段/NUL/URL scheme、不存在或越界的 documentEntry、脚本/凭据入口、无法归一的排除规则，以及任何疑似凭据字段。

## 3. 文档、revision 与索引身份

文档模型至少包含：

```text
libraryId / documentRef / title / path / tags / links / excerpt / text
contentHash / contentRevision / indexHash
```

- `documentRef` 是库内 POSIX 风格相对路径，不含绝对路径、盘符、`..`、NUL 或 URL scheme。
- 文件与目录 symlink 默认拒绝；每个目标 realpath 必须位于已登记 realRoot 内。
- 扫描限制深度、文件数与总字节；排除规则在 realpath 校验前后都生效。
- `contentHash = sha256(bytes)`。
- `contentRevision = sha256(sorted(path + NUL + contentHash + NUL))`。
- `indexHash` 绑定 contentRevision、manifest hash、customization hash、runtime version/commit/lock、chunking/profile 与索引格式版本。
- 索引状态只允许 `never-indexed/building/fresh/stale/failed`；失败 staging 永不发布。

## 4. 检索能力与 sidecar

能力：`knowledge.retrieval@1`。方法：`insert/query/read/health/indexStatus/stop`。

协议：`openstory.knowledge-sidecar@1`，JSONL stdio。

```json
{"protocol":"openstory.knowledge-sidecar@1","requestId":"<id>","method":"query","deadlineMs":15000,"payload":{}}
```

成功：

```json
{"protocol":"openstory.knowledge-sidecar@1","requestId":"<id>","ok":true,"result":{}}
```

失败：

```json
{"protocol":"openstory.knowledge-sidecar@1","requestId":"<id>","ok":false,"error":{"code":"QUERY_TIMEOUT","message":"..."}}
```

stdout 只允许协议帧；stderr 环形缓冲上限 64KiB；单帧上限 1MiB。固定绝对 venv Python，以 `-I` 启动；单活跃 worker、单库串行、requestId 精确匹配、deadline/cancel、崩溃立即失败、重复 stop 幂等。Windows 清理进程树，POSIX 清理独立进程组。

错误码：`RUNTIME_MISSING`、`RUNTIME_VERSION_MISMATCH`、`INDEX_NOT_READY`、`STALE_INDEX`、`QUERY_TIMEOUT`、`INDEX_BUILD_TIMEOUT`、`RUNTIME_CRASHED`、`REQUEST_CANCELLED`。不得用空 hits 伪装无资料。

## 5. canonical hit 与 provenance

```text
libraryId/ref/title/text/score/source/hash/provenance/tags
provenance.contentRevision/indexHash/engineVersion/documentRef/chunkId/locator/documentHash
```

去重键是 `(libraryId, documentRef, chunkId/locatorHash)`，不按 title 或正文去重。API、MCP、Agent 必须共用同一个 `KnowledgeSearchService`；Agent 只能裁剪与封装，不重查、不重排。

## 6. HyperGraphRAG 固定源与来源边界

- 官方仓库：`https://github.com/LHRLAB/HyperGraphRAG`
- 固定提交：`e01d2f2a5f3d1e80415b933c10fa7d14587cf811`
- 该提交没有 release/tag；PyPI 无同名发行包。安装必须使用固定源与锁定依赖，不能把 Pinax/storyflow 自研图实现当作 HyperGraphRAG。
- 官方公开 `query(only_need_context=True)` 返回拼接字符串，不直接返回 chunk/reference。worker 必须通过官方检索内部链路保留被选中的 text unit，并从官方 `text_chunks` 存储取回 `full_doc_id/chunk_order_index`；不得用自建词面检索替代。
- 若固定版本无法取得可验证的文档/chunk 映射，OS-230 必须报阻塞，不得宣称真实语义验收通过。

## 7. OS-230 质量门槛

- 来源正确率：100%。
- 负查询零相关误命中：100%。
- 宏平均 Recall@5 ≥ 0.85。
- 每题材 Recall@5 ≥ 0.75。
- Precision@5、p50/p95/max 延迟、构建时间与索引体积记录实测值；首轮不冻结机器相关硬阈值。
