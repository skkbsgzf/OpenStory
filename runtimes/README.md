# OpenStory Agent 运行时套件（runtime kit）规范 · openstory-runtime-kit@1

> 设计口径（作者 2026-11-15）：照 OpenDesign agent-runtimes 的接入方式——**OpenStory 只提供 kit
> 规范与装载层，不内置具体运行时**；Pi（OpenAI 兼容直连）是可选的原生兜底适配器。

## 一个 kit 是什么

一个目录，里面一份 `manifest.json`＋（sidecar 类）运行时本体：

```
runtimes/
  <kit-id>/
    manifest.json
    server.mjs（sidecar 类的入口；endpoint 类不需要）
```

发现目录（后者按 id 覆盖前者，同风格包口径）：

1. 内置：`openstory/runtimes/`
2. 本机：`%LOCALAPPDATA%/OpenStory/openstory/runtimes/`　——作者/社区/Agent 丢目录即上新

## manifest.json 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | ✓ | 必须 `openstory-runtime-kit@1`（别的版本跳过＋warning，不做半懂兼容） |
| `id` | ✓ | `[\w-]{1,40}`，全局唯一（本机可覆盖内置同名） |
| `name` | ✓ | 人话名（选择器上显示） |
| `kind` | ✓ | `sidecar`（daemon 拉起子进程）｜`endpoint`（直连现成服务） |
| `description` |  | 一句话说明 |
| `command` | sidecar✓ | `{ cmd, args[], cwd? }`；cwd 相对 kit 目录解析 |
| `chatPath` | ✓ | 默认 `/v1/chat/completions` |
| `healthPath` |  | sidecar 探活路径，默认 `/healthz` |
| `port` | sidecar✓ | `"allocate"`（daemon 分配空闲端口，经 env `OPENSTORY_RUNTIME_PORT` 注入）或固定数字 |
| `url` | endpoint✓ | 如 `http://127.0.0.1:9230` |
| `model` |  | 转发时的模型名（缺省不带 model 字段） |
| `apiKey` |  | kit 侧凭据——**只存本机 manifest，任何响应不回显** |
| `sha256` |  | kit 内容指纹（预留钉版；本批记录不校验） |

## chat 面（唯一的协议要求）

kit 只需要会说**一种话**：OpenAI 兼容流式。

```
POST {chatPath}
Body: { "model"?: string, "messages": [{role, content}...], "stream": true }
Resp: text/event-stream，data: {"choices":[{"delta":{"content":"…"}}]} … data: [DONE]
```

daemon 负责其余一切（会话 JSONL、历史组装、system prompt、待确认卡、停止/部分落档）。
非流式整段 JSON 也兼容（`choices[0].message.content` 兜底）。

**写 DSH 桥接 kit＝照抄 `echo-kit/server.mjs` 的骨架**：起服务→探活→把请求翻译给 DSH→
按 OpenAI SSE 吐回来。桥是 DSH 侧的事，规范在这里。

## 生命周期（sidecar）

daemon 按 kit id 进程内单例：spawn（env 注入 `OPENSTORY_RUNTIME_PORT`）→ 探活（≤15s）→
复用；进程退出＝标 stopped，下次聊天懒重启；daemon 关停统一收割子进程。
