"""
OpenStory 本地 embedding provider（OS-233）——给 HyperGraphRAG worker 用。

为什么单独成文件：worker 在固定 venv 里跑，import 路径要绝对可控；本文件
放在 `tools/knowledge-runtime/` 下，由 payload 的 embeddingModule 指过来。
工厂函数本身不加载模型，只讲 **OpenAI 兼容 /v1/embeddings** 的 HTTP 协议去
问仓内已有的 `src/modules/agent-runtime/embedding-server.mjs`（transformers.js
+bge-small-zh-v1.5 量化版，约 25MB）——所以语义检索的 embedding 默认是
**本地的、不联网、不需要 API key** 的。

契约（与 worker._make_embedding 对齐）：
    embeddingModule   "openstory_local_embedding"
    embeddingFactory  "make_embedding"
    embeddingConfig   { endpoint, model, batchSize, timeoutMs, dim, maxTokenSize }

返回 dict: { func, embedding_dim, max_token_size, concurrent_limit }
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

DEFAULT_ENDPOINT = "http://127.0.0.1:8808"
DEFAULT_MODEL = "Xenova/bge-small-zh-v1.5"
# bge-small-zh-v1.5 的输出维度固定 512；留给调用方覆盖的口子，但不猜。
DEFAULT_DIM = 512
DEFAULT_MAX_TOKENS = 512


def _post_embeddings(endpoint: str, model: str, texts: list[str], timeout: float) -> list[list[float]]:
    body = json.dumps({"model": model, "input": texts}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{endpoint.rstrip('/')}/v1/embeddings",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        # 让错误一路冒到 worker 的 RUNTIME_MISSING，绝不返回假向量。
        raise RuntimeError(f"本地 embedding 服务不可达（{endpoint}）：{error}") from error
    rows = payload.get("data")
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise RuntimeError("本地 embedding 返回条数与输入不一致")
    ordered = sorted(rows, key=lambda row: int(row.get("index", 0)))
    return [list(row.get("embedding") or []) for row in ordered]


def make_embedding(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """返回 worker 认得的 provider 形状；真正的网络调用发生在被调用时。"""
    config = config or {}
    endpoint = str(config.get("endpoint") or DEFAULT_ENDPOINT)
    model = str(config.get("model") or DEFAULT_MODEL)
    dim = int(config.get("dim") or DEFAULT_DIM)
    max_tokens = int(config.get("maxTokenSize") or DEFAULT_MAX_TOKENS)
    batch_size = max(1, int(config.get("batchSize") or 16))
    timeout = float(config.get("timeoutMs") or 60000) / 1000.0

    def embed(texts):
        values = [str(item) for item in texts]
        out: list[list[float]] = []
        for start in range(0, len(values), batch_size):
            out.extend(_post_embeddings(endpoint, model, values[start:start + batch_size], timeout))
        return out

    return {
        "func": embed,
        "embedding_dim": dim,
        "max_token_size": max_tokens,
        "concurrent_limit": int(config.get("concurrency") or 4),
    }
