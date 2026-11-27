#!/usr/bin/env python3
"""OS-228 fixed-commit HyperGraphRAG JSONL worker.

stdout is exclusively openstory.knowledge-sidecar@1. The official operate.py
contains bare print() calls, so stdout is redirected to stderr while a request is
executed; protocol frames always use a private duplicate of the original stdout.

The query path calls the official kg_query and _get_node_data/_get_edge_data chain
through a capture wrapper. The selected text units are then looked up in the
official text_chunks KV store; full_doc_id/chunk_order_index are mandatory.
No keyword/lexical fallback is implemented.
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import dataclasses
import hashlib
import inspect
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

PROTOCOL = "openstory.knowledge-sidecar@1"
COMMIT = "e01d2f2a5f3d1e80415b933c10fa7d14587cf811"
ENGINE_VERSION = f"LHRLAB/HyperGraphRAG@{COMMIT}"
MAX_FRAME = 1024 * 1024
SOURCE_PATH = Path(__file__).with_name("runtime-source.json")
_PROTOCOL_STDOUT = os.dup(1)
_CAPTURE: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "openstory_hypergraph_selected_text_units", default=None
)
_QUERY_CACHE: dict[tuple[str, str, str], Any] = {}
_QUERY_LOCKS: dict[tuple[str, str, str], asyncio.Lock] = {}


class WorkerError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def fail(code: str, message: str, details: dict[str, Any] | None = None) -> None:
    raise WorkerError(code, message, details)


def _hash(value: Any) -> str:
    return hashlib.sha256(value).hexdigest()


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _plain(value: Any) -> bool:
    return isinstance(value, dict)


def _source() -> dict[str, Any]:
    try:
        raw = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    except Exception:
        fail("RUNTIME_VERSION_MISMATCH", "runtime-source.json 缺失或损坏")
    if raw.get("commit") != COMMIT or raw.get("provenanceRule") != "official-selected-text-units+text_chunks-v1":
        fail("RUNTIME_VERSION_MISMATCH", "runtime-source.json 不是批准的固定提交来源")
    return raw


def _safe_ref(value: Any) -> bool:
    ref = _text(value).replace("\\", "/")
    return bool(ref) and not ref.startswith("/") and "://" not in ref and not ref.startswith("..") and "\x00" not in ref and all(part not in ("", ".", "..") for part in ref.split("/"))


def _read_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    input_dir = payload.get("inputDir")
    if not isinstance(input_dir, str) or not input_dir:
        fail("INVALID_REQUEST", "inputDir 必填")
    root = Path(input_dir).resolve()
    snapshot = json.loads((root / "snapshot.json").read_text(encoding="utf-8"))
    if snapshot.get("schema") != "openstory.knowledge-snapshot@1" or snapshot.get("schemaVersion") != 1:
        fail("INDEX_NOT_READY", "staging snapshot 形状非法")
    docs = []
    for line in (root / "documents.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            docs.append(json.loads(line))
    return {"root": root, "snapshot": snapshot, "documents": docs}


def _index_dir(payload: dict[str, Any]) -> Path:
    value = payload.get("indexPath")
    if not isinstance(value, str) or not value:
        fail("INDEX_NOT_READY", "indexPath 必填")
    path = Path(value).resolve()
    manifest = path / "index.json"
    if not manifest.is_file():
        fail("INDEX_NOT_READY", "索引尚未发布或 index.json 缺失")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if data.get("schema") != "hypergraphrag-index@1" or data.get("schemaVersion") != 1:
        fail("INDEX_NOT_READY", "已发布索引形状非法")
    if payload.get("contentRevision") and data.get("contentRevision") != payload["contentRevision"]:
        fail("STALE_INDEX", "索引 contentRevision 与当前源不一致")
    if payload.get("indexHash") and data.get("indexHash") != payload["indexHash"]:
        fail("STALE_INDEX", "索引 indexHash 与请求不一致")
    return path


def _document_map(root: Path) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    for line in (root / "documents.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        ref = _text(row.get("documentRef"))
        if not _safe_ref(ref):
            fail("INVALID_REQUEST", "documents.jsonl 含非法 documentRef")
        target = (root / ref).resolve()
        if root not in target.parents:
            fail("PATH_ESCAPE", "documentRef 越出只读快照")
        raw = target.read_bytes()
        docs[ref] = {
            "documentRef": ref,
            "title": _text(row.get("title") or ref),
            "tags": row.get("tags") if isinstance(row.get("tags"), list) else [],
            "documentHash": _hash(raw),
        }
    return docs


def _parse_csv(text_value: str) -> list[list[str]]:
    import csv
    import io

    return list(csv.reader(io.StringIO(text_value)))


def _capture_results(csv_value: Any) -> list[list[str]]:
    value = _text(csv_value)
    if not value:
        return []
    if value.lstrip().startswith("["):
        try:
            rows = json.loads(value)
            if isinstance(rows, list) and all(isinstance(row, list) for row in rows):
                return rows
        except Exception:
            pass
    return _parse_csv(value)


def _selected_ids(csv_value: Any) -> list[str]:
    rows = _capture_results(csv_value)
    if not rows:
        return []
    header = [_text(cell).strip().lower() for cell in rows[0]]
    if "content" not in header:
        return []
    index = header.index("content")
    ids: list[str] = []
    for row in rows[1:]:
        if len(row) <= index:
            continue
        try:
            value = row[index]
            parsed = json.loads(value)
        except Exception:
            parsed = None
        chunk_id = parsed.get("id") if _plain(parsed) else None
        if not chunk_id and isinstance(parsed, str):
            chunk_id = parsed
        if not chunk_id:
            chunk_id = f"selected-{len(ids)}"
        if chunk_id not in ids:
            ids.append(_text(chunk_id))
    return ids


def _verify_official_shape(source: Path) -> None:
    operate = (source / "operate.py").read_text(encoding="utf-8")
    storage = (source / "storage.py").read_text(encoding="utf-8")
    base = (source / "base.py").read_text(encoding="utf-8")
    if "async def kg_query(" not in operate or "async def _get_node_data(" not in operate or "async def _get_edge_data(" not in operate:
        fail("RUNTIME_VERSION_MISMATCH", "固定提交缺少 kg_query/_get_node_data/_get_edge_data API")
    if '"full_doc_id": str' not in base or '"chunk_order_index": int' not in base:
        fail("RUNTIME_VERSION_MISMATCH", "固定提交 TextChunkSchema 缺少 provenance 字段")
    if "class JsonKVStorage" not in storage:
        fail("RUNTIME_VERSION_MISMATCH", "固定提交缺少官方 JsonKVStorage")


def _record_selected(csv_value: Any) -> None:
    capture = _CAPTURE.get()
    if capture is not None:
        capture["text_units"].append(_capture_results(csv_value))


def _record_raw_units(units: Any) -> None:
    capture = _CAPTURE.get()
    if capture is not None and isinstance(units, list):
        capture["raw_text_units"].extend(row for row in units if _plain(row))


async def _invoke_official(awaitable: Any) -> Any:
    return await awaitable


def _wrapped_get_node(original):
    async def wrapper(query, knowledge_graph_inst, entities_vdb, text_chunks_db, query_param):
        result = await original(query, knowledge_graph_inst, entities_vdb, text_chunks_db, query_param)
        _record_selected(result[2])
        return result

    return wrapper


def _wrapped_get_edge(original):
    async def wrapper(keywords, knowledge_graph_inst, hyperedges_vdb, text_chunks_db, query_param):
        result = await original(keywords, knowledge_graph_inst, hyperedges_vdb, text_chunks_db, query_param)
        _record_selected(result[2])
        return result

    return wrapper


def _wrapped_text_units_from_entities(original):
    async def wrapper(node_datas, query_param, text_chunks_db, knowledge_graph_inst):
        result = await original(node_datas, query_param, text_chunks_db, knowledge_graph_inst)
        _record_raw_units(result)
        return result

    return wrapper


def _wrapped_text_units_from_relationships(original):
    async def wrapper(edge_datas, query_param, text_chunks_db, knowledge_graph_inst):
        result = await original(edge_datas, query_param, text_chunks_db, knowledge_graph_inst)
        _record_raw_units(result)
        return result

    return wrapper


def _wrapped_kg_query(original):
    async def wrapper(query, knowledge_graph_inst, entities_vdb, hyperedges_vdb, text_chunks_db, query_param, global_config, hashing_kv=None):
        # This is the official kg_query internal chain, not a replacement query.
        return await original(query, knowledge_graph_inst, entities_vdb, hyperedges_vdb, text_chunks_db, query_param, global_config, hashing_kv=hashing_kv)

    return wrapper


def _official_runtime(source: Path, source_root: Path, snapshot: dict[str, Any]) -> tuple[Any, Any]:
    try:
        import importlib
        import importlib.metadata
        import sys

        dist_name = source.get("distribution")
        if not dist_name:
            fail("RUNTIME_VERSION_MISMATCH", "尚未锁定可安装的官方 distribution；拒绝猜测包名")
        try:
            distribution = importlib.metadata.distribution(dist_name)
        except importlib.metadata.PackageNotFoundError:
            fail("RUNTIME_MISSING", f"固定 venv 未安装官方 {dist_name}")
        direct_url = distribution.read_text("direct_url.json")
        if direct_url:
            direct = json.loads(direct_url)
            vcs = direct.get("vcs_info", {})
            if vcs.get("vcs") != "git" or vcs.get("commit_id") != COMMIT:
                fail("RUNTIME_VERSION_MISMATCH", "已安装包不是批准的 HyperGraphRAG git commit")
        else:
            fail("RUNTIME_VERSION_MISMATCH", "官方包缺少 direct_url.json，无法证明固定 commit")
        files = distribution.files or []
        locations = {str(distribution.locate_file(item)) for item in files if _text(getattr(item, "name", "")).endswith(".py")}
        if not locations:
            fail("RUNTIME_VERSION_MISMATCH", "无法定位已安装官方源码")
        package_root = Path(next(iter(locations))).parent
        if package_root.name != "hypergraphrag":
            package_root = package_root / "hypergraphrag"
        _verify_official_shape(package_root)
        inserted = False
        if str(package_root.parent) not in sys.path:
            sys.path.insert(0, str(package_root.parent))
            inserted = True
        try:
            operate = importlib.import_module("hypergraphrag.operate")
            base = importlib.import_module("hypergraphrag.base")
            storage = importlib.import_module("hypergraphrag.storage")
            public = importlib.import_module("hypergraphrag.hypergraphrag")
        finally:
            if inserted:
                sys.path.remove(str(package_root.parent))
        operate._get_node_data = _wrapped_get_node(operate._get_node_data)
        operate._get_edge_data = _wrapped_get_edge(operate._get_edge_data)
        operate._find_most_related_text_unit_from_entities = _wrapped_text_units_from_entities(operate._find_most_related_text_unit_from_entities)
        operate._find_related_text_unit_from_relationships = _wrapped_text_units_from_relationships(operate._find_related_text_unit_from_relationships)
        public.kg_query = _wrapped_kg_query(operate.kg_query)
        return public, (operate, base, storage)
    except WorkerError:
        raise
    except Exception as error:
        fail("RUNTIME_VERSION_MISMATCH", f"固定 HyperGraphRAG API 无法验证：{type(error).__name__}: {error}")


def _make_embedding(payload: dict[str, Any]):
    from dataclasses import asdict
    from hypergraphrag.utils import EmbeddingFunc

    module_name = payload.get("embeddingModule")
    factory_name = payload.get("embeddingFactory")
    if not isinstance(module_name, str) or not module_name or not isinstance(factory_name, str) or not factory_name:
        fail("RUNTIME_MISSING", "需要显式 embeddingModule/embeddingFactory；本 worker 不下载模型")
    import importlib

    try:
        module = importlib.import_module(module_name)
        factory = getattr(module, factory_name)
        value = factory(payload.get("embeddingConfig") or {})
    except Exception as error:
        fail("RUNTIME_MISSING", f"embedding provider 不可用：{type(error).__name__}: {error}")
    if isinstance(value, EmbeddingFunc):
        return value
    if callable(value) and hasattr(value, "embedding_dim") and hasattr(value, "max_token_size"):
        return EmbeddingFunc(int(value.embedding_dim), int(value.max_token_size), value, concurrent_limit=payload.get("embeddingConcurrency", 4))
    if _plain(value) and callable(value.get("func")):
        return EmbeddingFunc(int(value["embedding_dim"]), int(value.get("max_token_size", 8192)), value["func"], concurrent_limit=value.get("concurrent_limit", 4))
    fail("RUNTIME_VERSION_MISMATCH", "embedding provider 未返回官方 EmbeddingFunc")


def _make_llm(payload: dict[str, Any]):
    module_name = payload.get("llmModule")
    factory_name = payload.get("llmFactory")
    if not isinstance(module_name, str) or not module_name or not isinstance(factory_name, str) or not factory_name:
        fail("RUNTIME_MISSING", "需要显式 llmModule/llmFactory；本 worker 不下载模型")
    import importlib

    try:
        factory = getattr(importlib.import_module(module_name), factory_name)
        value = factory(payload.get("llmConfig") or {})
    except Exception as error:
        fail("RUNTIME_MISSING", f"LLM provider 不可用：{type(error).__name__}: {error}")
    if not callable(value):
        fail("RUNTIME_VERSION_MISMATCH", "llmFactory 未返回可调用官方 llm_model_func")
    return value


async def _query_async(rag: Any, payload: dict[str, Any]) -> dict[str, Any]:
    from dataclasses import asdict
    from hypergraphrag import operate as operate_module

    key = (rag.working_dir, payload.get("indexHash", ""), payload.get("contentRevision", ""))
    async with _QUERY_LOCKS.setdefault(key, asyncio.Lock()):
        if key in _QUERY_CACHE:
            return _QUERY_CACHE[key]
        capture = {"text_units": [], "raw_text_units": []}
        token = _CAPTURE.set(capture)
        try:
            query = _text(payload.get("query")).strip()
            if not query:
                fail("INVALID_REQUEST", "query 必填")
            param = operate_module.QueryParam(
                mode="hybrid",
                only_need_context=True,
                stream=False,
                top_k=int(payload.get("topK") or 20),
                max_token_for_text_unit=int(payload.get("maxTokenForTextUnit") or 12000),
                max_token_for_global_context=int(payload.get("maxTokenForGlobalContext") or 12000),
            )
            public_query = await rag.aquery(query, param)
            if not isinstance(public_query, str):
                fail("RUNTIME_VERSION_MISMATCH", "官方 query(only_need_context=True) 未返回字符串")
            raw_units = capture["raw_text_units"]
            if not raw_units:
                fail("INDEX_NOT_READY", "官方检索内部函数未返回原始 text units；CSV 行号不是 chunk id，拒绝伪造 provenance")
            all_keys = await rag.text_chunks.all_keys()
            candidate_rows = await asyncio.gather(*(rag.text_chunks.get_by_id(chunk_key) for chunk_key in all_keys))
            content_to_id: dict[str, list[str]] = {}
            for chunk_key, row in zip(all_keys, candidate_rows):
                if _plain(row) and "content" in row:
                    content_to_id.setdefault(_text(row["content"]), []).append(_text(chunk_key))
            units: list[dict[str, Any]] = []
            seen: set[str] = set()
            for unit in raw_units:
                content = _text(unit.get("content"))
                if not content:
                    continue
                # The fixed commit's TextChunk records have no id field. Match the
                # selected official unit to the official text_chunks KV by exact
                # content and require a unique chunk id; never manufacture selected-N.
                matches = content_to_id.get(content, [])
                if len(matches) != 1:
                    fail("INDEX_NOT_READY", f"官方 text unit 无法唯一映射 text_chunks chunk id（matches={len(matches)}）")
                chunk_id = matches[0]
                if chunk_id not in seen:
                    seen.add(chunk_id)
                    units.append({"id": chunk_id, "content": content})
            if not units:
                fail("INDEX_NOT_READY", "官方 text units 为空，拒绝空 hits 冒充无资料")
            docs = _document_map(Path(payload["_snapshotRoot"]))
            chunk_map = {_text(row.get("id")): row for row in units}
            official_chunks = await asyncio.gather(*(rag.text_chunks.get_by_id(chunk_id) for chunk_id in chunk_map))
            hits = []
            for order, (unit, official) in enumerate(zip(chunk_map.values(), official_chunks)):
                if not _plain(official) or "content" not in official or "full_doc_id" not in official or "chunk_order_index" not in official:
                    fail("INDEX_NOT_READY", "官方 text_chunks 缺少 full_doc_id/chunk_order_index，无法证明 provenance")
                doc_id = _text(official["full_doc_id"])
                chunk_order = official["chunk_order_index"]
                if not isinstance(chunk_order, int):
                    fail("RUNTIME_VERSION_MISMATCH", "chunk_order_index 不是整数")
                document = docs.get(doc_id)
                if document is None:
                    fail("INDEX_NOT_READY", "text_chunks.full_doc_id 不在只读快照 manifest")
                if official["content"] != unit["content"]:
                    fail("RUNTIME_VERSION_MISMATCH", "官方选中 text unit 与 text_chunks 内容不一致")
                chunk_id = f"{doc_id}#chunk-{chunk_order}"
                provenance = {
                    "contentRevision": payload["contentRevision"],
                    "indexHash": payload["indexHash"],
                    "engineVersion": ENGINE_VERSION,
                    "documentRef": doc_id,
                    "chunkId": chunk_id,
                    "locator": f"{doc_id}:{chunk_order}",
                    "documentHash": document["documentHash"],
                }
                hits.append({
                    "libraryId": payload["libraryId"],
                    "ref": doc_id,
                    "title": document["title"],
                    "text": official["content"],
                    "score": 1.0,
                    "source": "hypergraphrag",
                    "hash": _hash(official["content"].encode("utf-8")),
                    "provenance": provenance,
                    "tags": document["tags"],
                    "selection": {"officialTextUnitIndex": order, "officialChunkId": unit["id"], "fullDocId": doc_id, "chunkOrderIndex": chunk_order},
                })
            result = {"hits": hits, "context": public_query, "engineVersion": ENGINE_VERSION, "commit": COMMIT}
            _QUERY_CACHE[key] = result
            return result
        finally:
            _CAPTURE.reset(token)


async def insert_async(payload: dict[str, Any]) -> dict[str, Any]:
    source = _source()
    staged = _read_snapshot(payload)
    public, _modules = _official_runtime(source, staged["root"], staged["snapshot"])
    output = Path(payload["outputDir"]).resolve()
    working = output / "hypergraphrag"
    working.mkdir(parents=True, exist_ok=True)
    docs = _document_map(staged["root"])
    texts = [(staged["root"] / ref).read_text(encoding="utf-8").strip() for ref in docs]
    rag = public.HyperGraphRAG(
        working_dir=str(working),
        kv_storage="JsonKVStorage",
        vector_storage="NanoVectorDBStorage",
        graph_storage="NetworkXStorage",
        embedding_func=_make_embedding(payload),
        llm_model_func=_make_llm(payload),
        enable_llm_cache=False,
        chunk_token_size=int(payload.get("chunkTokenSize") or 1200),
        chunk_overlap_token_size=int(payload.get("chunkOverlapTokenSize") or 100),
        addon_params={"language": _text(payload.get("language") or "Chinese")},
    )
    await rag.ainsert(texts)
    stored = await asyncio.gather(*(rag.text_chunks.get_by_id(key) for key in await rag.text_chunks.all_keys()))
    by_doc: dict[str, list[int]] = {}
    for chunk in stored:
        if _plain(chunk) and "full_doc_id" in chunk and "chunk_order_index" in chunk:
            by_doc.setdefault(_text(chunk["full_doc_id"]), []).append(int(chunk["chunk_order_index"]))
    for ref in docs:
        if ref not in by_doc:
            fail("INDEX_NOT_READY", f"官方插入未产生 {ref} 的 text_chunks")
    index = {
        "schema": "hypergraphrag-index@1",
        "schemaVersion": 1,
        "libraryId": payload["libraryId"],
        "operationId": payload["operationId"],
        "indexHash": staged["snapshot"]["indexHash"],
        "contentRevision": payload["contentRevision"],
        "engineVersion": ENGINE_VERSION,
        "commit": COMMIT,
        "profileVersion": staged["snapshot"]["profileVersion"],
        "documents": len(docs),
        "chunks": len(stored),
        "workingDir": "hypergraphrag",
    }
    await asyncio.to_thread(_write_json, output / "index.json", index)
    ready = {
        "schema": "openstory.hypergraphrag-ready@1",
        "schemaVersion": 1,
        "libraryId": payload["libraryId"],
        "operationId": payload["operationId"],
        "indexHash": staged["snapshot"]["indexHash"],
        "chunks": len(stored),
    }
    await asyncio.to_thread(_write_json, output / "hypergraphrag.ready.json", ready)
    return {"indexHash": staged["snapshot"]["indexHash"], "documents": len(docs), "chunks": len(stored), "engineVersion": ENGINE_VERSION, "commit": COMMIT}


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


async def read_async(payload: dict[str, Any]) -> dict[str, Any]:
    path = _index_dir(payload)
    ref = _text(payload.get("documentRef") or payload.get("ref"))
    if not _safe_ref(ref):
        fail("INVALID_REQUEST", "documentRef 必填且必须是库内相对路径")
    root = path / "snapshot"
    target = (root / ref).resolve()
    if root not in target.parents:
        fail("PATH_ESCAPE", "documentRef 越界")
    try:
        raw = target.read_bytes()
    except FileNotFoundError:
        fail("INDEX_NOT_READY", "已发布索引没有该文档只读快照")
    return {"document": {"libraryId": payload["libraryId"], "documentRef": ref, "text": raw.decode("utf-8"), "documentHash": _hash(raw), "indexHash": payload.get("indexHash"), "engineVersion": ENGINE_VERSION}}


def _copy_readonly_snapshot(input_root: Path, output: Path) -> None:
    import shutil

    target = output / "snapshot"
    shutil.copytree(input_root, target)
    # Read-only intent is enforced by Node ownership; copied files stay within staging.


async def query_async(payload: dict[str, Any]) -> dict[str, Any]:
    path = _index_dir(payload)
    staged = {"root": path / "snapshot"}
    source = _source()
    public, _modules = _official_runtime(source, staged["root"], {"indexHash": payload["indexHash"]})
    rag = public.HyperGraphRAG(
        working_dir=str(path / "hypergraphrag"),
        kv_storage="JsonKVStorage",
        vector_storage="NanoVectorDBStorage",
        graph_storage="NetworkXStorage",
        embedding_func=_make_embedding(payload),
        llm_model_func=_make_llm(payload),
        enable_llm_cache=False,
    )
    copied = dict(payload)
    copied["_snapshotRoot"] = staged["root"]
    return await _query_async(rag, copied)


async def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("protocol") != PROTOCOL:
        fail("PROTOCOL_MISMATCH", "请求协议不符")
    if not isinstance(request.get("requestId"), str) or not request["requestId"]:
        fail("INVALID_REQUEST", "requestId 必填")
    method = request.get("method")
    payload = request.get("payload")
    if not _plain(payload):
        fail("INVALID_REQUEST", "payload 必须是对象")
    deadline_ms = request.get("deadlineMs")
    if not isinstance(deadline_ms, int) or deadline_ms <= 0:
        fail("INVALID_REQUEST", "deadlineMs 必须是正整数")
    if method == "health":
        result = {"protocol": PROTOCOL, "engine": "hypergraphrag", "commit": COMMIT, "engineVersion": ENGINE_VERSION, "ready": True, "distribution": _source().get("distribution"), "sourceVerified": False}
        return await asyncio.wait_for(asyncio.to_thread(_health, result), timeout=deadline_ms / 1000)
    if method == "index.status":
        return await asyncio.wait_for(asyncio.to_thread(_status, payload), timeout=deadline_ms / 1000)
    if method == "insert":
        result = await insert_async(payload)
        await asyncio.to_thread(_copy_readonly_snapshot, Path(payload["inputDir"]).resolve(), Path(payload["outputDir"]).resolve())
        return result
    if method == "query":
        return await _query_async_for_request(payload, deadline_ms)
    if method == "read":
        return await asyncio.wait_for(read_async(payload), timeout=deadline_ms / 1000)
    if method in ("shutdown", "stop"):
        return {"stopping": True}
    fail("INVALID_REQUEST", f"未知 method：{_text(method)}")


def _health(result: dict[str, Any]) -> dict[str, Any]:
    source = _source()
    if not source.get("distribution") or not source.get("dependencyLockSha256"):
        fail("RUNTIME_MISSING", "fixed commit API verified; install distribution/lock not yet locked")
    try:
        import importlib.metadata
        distribution = importlib.metadata.distribution(source["distribution"])
    except Exception:
        fail("RUNTIME_MISSING", "fixed runtime distribution is not installed")
    direct = distribution.read_text("direct_url.json")
    if not direct or json.loads(direct).get("vcs_info", {}).get("commit_id") != COMMIT:
        fail("RUNTIME_VERSION_MISMATCH", "installed runtime distribution is not the fixed commit")
    result.update({"sourceVerified": True, "installedDistribution": source["distribution"]})
    return result


def _status(payload: dict[str, Any]) -> dict[str, Any]:
    current = payload.get("currentPath")
    if not isinstance(current, str) or not current:
        fail("INVALID_REQUEST", "currentPath 必填")
    try:
        pointer = json.loads(Path(current).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "never-indexed", "indexHash": None}
    if pointer.get("schema") != "openstory.knowledge-index-pointer@1":
        fail("INDEX_NOT_READY", "current.json 形状非法")
    if payload.get("contentRevision") and pointer.get("contentRevision") != payload["contentRevision"]:
        return {"status": "stale", "indexHash": pointer.get("indexHash"), "contentRevision": pointer.get("contentRevision")}
    return {"status": "fresh", "indexHash": pointer.get("indexHash"), "contentRevision": pointer.get("contentRevision"), "builtAt": pointer.get("publishedAt")}


async def _query_async_for_request(payload: dict[str, Any], deadline_ms: int) -> dict[str, Any]:
    try:
        return await asyncio.wait_for(query_async(payload), timeout=deadline_ms / 1000)
    except asyncio.TimeoutError:
        fail("QUERY_TIMEOUT", f"query 超过 {deadline_ms}ms")


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"code": code, "message": message, "details": details or {}}


async def _one(line: bytes) -> bool:
    request_id: str | None = None
    try:
        if len(line) > MAX_FRAME:
            raise WorkerError("PROTOCOL_MISMATCH", f"输入帧超过 {MAX_FRAME} bytes")
        request = json.loads(line.decode("utf-8"))
        if _plain(request):
            request_id = _text(request.get("requestId")) or None
        result = await dispatch(request)
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": True, "result": result}
    except WorkerError as error:
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": False, "error": _error(error.code, error.message, error.details)}
    except asyncio.TimeoutError:
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": False, "error": _error("QUERY_TIMEOUT", "sidecar deadline 已到")}
    except asyncio.CancelledError:
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": False, "error": _error("REQUEST_CANCELLED", "sidecar 请求已取消")}
    except Exception as error:
        print(f"worker failure: {traceback.format_exc()}", file=sys.stderr, flush=True)
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": False, "error": _error("RUNTIME_CRASHED", f"{type(error).__name__}: {error}")}
    encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) + 1 > MAX_FRAME:
        response = {"protocol": PROTOCOL, "requestId": request_id, "ok": False, "error": _error("PROTOCOL_MISMATCH", "响应帧超过 1 MiB")}
        encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    os.write(_PROTOCOL_STDOUT, encoded + b"\n")
    return isinstance(request, dict) and request.get("method") not in ("shutdown", "stop")


async def main() -> None:
    original_stdout = sys.stdout
    running = True
    # Windows Proactor emits an invalid-handle callback when connect_read_pipe sees
    # stdin EOF. Read lines in a worker thread instead; asyncio only awaits them.
    while running:
        line = await asyncio.to_thread(sys.stdin.buffer.readline)
        if not line:
            break
        # Official modules and tqdm print to stdout. Keep them out of JSONL.
        sys.stdout = sys.stderr
        token = _CAPTURE.set(None)
        try:
            running = await _one(line)
        finally:
            _CAPTURE.reset(token)
            sys.stdout = original_stdout


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        asyncio.run(main())
