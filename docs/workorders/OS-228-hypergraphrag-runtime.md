# OS-228 · HyperGraphRAG 内核与 sidecar

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-226 |
| 允许改动 | `src/modules/knowledge-runtime/**`、`src/protocol/capabilityImplementations.mjs`、`tools/knowledge-runtime/**`、`test/hypergraph*.test.mjs`、`test/knowledge*.test.mjs`、`docs/protocol/**`、相关数字锚 |
| 风险 | 高——Python 伴生进程与索引安全 |
| 状态 | 待施工 |

## 目标

提供首版真实 HyperGraphRAG 能力，同时保持 Node 侧可测试、可取消、可隔离。

## 任务

1. 新 kernel `knowledge-runtime`：`knowledge.retrieval@1`，零 UI/endpoint；能力方法 insert/query/read/health/indexStatus。
2. 固定版本 Python worker＋JSONL stdio 协议：requestId/ok/error、health、insert、query、read、index.status、shutdown；stdout 只允许协议帧。
3. Node sidecar 生命周期：启动校验版本/协议、health ready、单库串行、请求 deadline、stderr 限量、崩溃/超时、daemon close/shutdown、Windows 进程树清理。
4. 工作目录隔离：operationId 临时 input/output/logs；源 markdown 只读快照；索引写缓存目录，成功后原子发布；失败不发布半成品。
5. stale/未安装/协议不符/崩溃类型化：RUNTIME_MISSING、INDEX_NOT_READY、STALE_INDEX、QUERY_TIMEOUT 等，不返回空 hits 冒充无资料。
6. 假 sidecar 测试与真实安装/health 测试分开；真实模型/下载不进入普通 npm test。

## 验收

- 假 sidecar 下全协议、超时、崩溃、重复 stop、请求错 id、源目录 hash 不变通过。
- 真实固定版本 worker 可安装并 health/insert/query/read；无 runtime 时明确 RUNTIME_MISSING。
- kernel 停用后检索回 PLUGIN_DEGRADED，文档浏览仍可用；不删源文件/定制/缓存以外的数据。
- 全量测试、验收、数字锚全绿；不 push。
