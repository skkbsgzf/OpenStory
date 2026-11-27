/**
 * KB 适配层（OS-21 前置）——知识库的唯一边界。
 *
 * 设计口径（见 docs/STYLEKIT-PROTOCOL-20261116.md §3.1）：
 *   上层（stylekit 装配器）只认这三个能力，绝不接触 WeKnora 的内部模型：
 *     listCollections()            → [{id,name,docCount,desc}]
 *     query(collectionIds, text)   → [{id,text,score,source,meta}]
 *     doc(id)                      → {id,title,source,meta}
 *   后端可替换：weknora（REST）｜mock（内置夹具，测试与离线用）。
 * 凭据只在本机配置里读；KB 不可达＝KB_UNAVAILABLE 如实报，绝不返回假命中。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { courtyardPath } from '../../protocol/courtyard.mjs'

function text(value) {
  return String(value ?? '')
}

export const KB_ERROR_CODES = Object.freeze({
  KB_UNAVAILABLE: 'KB_UNAVAILABLE',
  KB_UNAUTHORIZED: 'KB_UNAUTHORIZED',
  KB_BAD_RESPONSE: 'KB_BAD_RESPONSE',
  KB_NOT_CONFIGURED: 'KB_NOT_CONFIGURED'
})

function fail(code, message) {
  return { ok: false, code, message }
}

/* ---------- 配置 ---------- */

export function defaultKbConfigPath(env = process.env) {
  return courtyardPath(env, 'openstory', 'kb-config.json')
}

/**
 * 本机凭据的尾号掩码。与 agent-runtime 的 maskApiKey 保持同一纯函数口径；
 * 工作台不得跨模块静态 import 内核实现，因此本模块持等价定义并由定向测试钉死。
 */
export function maskApiKey(key) {
  const raw = String(key ?? '').trim()
  if (!raw) return ''
  if (raw.length <= 8) return '••••'
  return `••••${raw.slice(-4)}`
}

/** 文件故障不回显原始内容/底层消息，避免配置片段或密钥进入日志与错误信封。 */
function configFailureMessage() {
  return 'KB 配置不是合法 JSON 或不可读；请先修复原文件，未做任何覆盖'
}

/**
 * 读取并校验磁盘配置。坏 JSON、非对象形状与任何读取失败统一报 KB_CONFIG_CORRUPT；
 * 缺失文件仍是合法的未配置状态。调用方（尤其 PUT）必须在写盘前检查 ok。
 */
export async function loadKbConfig(configPath) {
  const target = text(configPath).trim()
  if (!target) return { ok: false, code: 'KB_CONFIG_CORRUPT', message: configFailureMessage(), config: { backend: 'none' }, warnings: [] }
  let raw
  try {
    raw = await readFile(target, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, exists: false, config: { backend: 'none' }, warnings: [] }
    return { ok: false, code: 'KB_CONFIG_CORRUPT', message: configFailureMessage(), config: { backend: 'none' }, warnings: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'KB_CONFIG_CORRUPT', message: configFailureMessage(), config: { backend: 'none' }, warnings: [] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'KB_CONFIG_CORRUPT', message: configFailureMessage(), config: { backend: 'none' }, warnings: [] }
  }
  const backend = text(parsed?.backend).trim()
  if (!backend) return { ok: true, exists: true, config: parsed, warnings: [] }
  if (backend !== 'weknora' && backend !== 'mock') {
    return { ok: false, code: 'KB_CONFIG_BACKEND', message: 'KB 配置 backend 只支持 weknora/mock', config: { backend: 'none' }, warnings: [] }
  }
  return {
    ok: true,
    exists: true,
    config: {
      ...parsed,
      backend,
      baseUrl: text(parsed.baseUrl).trim().replace(/\/+$/u, ''),
      apiKey: text(parsed.apiKey).trim(),
      spaceId: text(parsed.spaceId).trim(),
      collections: parsed.collections && typeof parsed.collections === 'object' && !Array.isArray(parsed.collections) ? parsed.collections : {}
    },
    warnings: []
  }
}

/* ---------- 响应规整（WeKnora → 我们的最小形状）---------- */

/** WeKnora 的列表响应 → [{id,name,docCount,desc}]（字段名做多路兜底，换版本不崩）。 */
export function normalizeCollections(payload) {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.knowledge_bases) ? payload.knowledge_bases
        : Array.isArray(payload?.items) ? payload.items
          : []
  return list.map((item) => ({
    id: text(item?.id ?? item?.kb_id ?? item?.knowledge_base_id),
    name: text(item?.name ?? item?.title ?? item?.id),
    docCount: Number(item?.doc_count ?? item?.document_count ?? item?.count ?? 0) || 0,
    desc: text(item?.description ?? item?.desc)
  })).filter((item) => item.id)
}

/**
 * 检索响应规整。WeKnora 实测形状（v0.9.0，internal/handler/session/qa.go）：
 *   { success:true, data:[<chunk>], meta:{...} }
 * chunk 字段（internal/types/chunk.go）：id / content / knowledge_id / knowledge_base_id / chunk_index / start_at…
 * 同时兼容 data 为对象包一层 results/hits 的旧包法。
 */
export function normalizeHits(payload) {
  const inner = payload?.data ?? payload
  const list = Array.isArray(inner) ? inner
    : Array.isArray(inner?.results) ? inner.results
      : Array.isArray(inner?.hits) ? inner.hits
        : Array.isArray(payload?.results) ? payload.results
          : []
  return list.map((item) => {
    const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
    const chunkIndex = Number.isSafeInteger(item?.chunk_index) ? item.chunk_index
      : Number.isSafeInteger(meta.chunkIndex) ? meta.chunkIndex : undefined
    return {
      id: text(item?.id ?? item?.chunk_id ?? item?.knowledge_id),
      text: text(item?.content ?? item?.text ?? item?.chunk ?? item?.snippet),
      score: Number(item?.score ?? item?.similarity ?? item?.rerank_score ?? 0) || 0,
      source: text(item?.knowledge_title ?? item?.title ?? item?.knowledge_id ?? item?.knowledge_base_id),
      knowledgeId: text(item?.knowledge_id ?? meta.knowledgeId),
      knowledgeBaseId: text(item?.knowledge_base_id ?? meta.knowledgeBaseId),
      ...(chunkIndex !== undefined ? { chunkIndex } : {}),
      meta: {
        ...meta,
        knowledgeId: text(item?.knowledge_id ?? meta.knowledgeId),
        knowledgeBaseId: text(item?.knowledge_base_id ?? meta.knowledgeBaseId),
        ...(chunkIndex !== undefined ? { chunkIndex } : {})
      }
    }
  }).filter((hit) => hit.text)
}

/* ---------- 适配器 ---------- */

/**
 * 造一个 KB 客户端。返回 {backend, listCollections, query, doc}，每个都返回 {ok,...}。
 * mock 后端：用内存夹具（测试/离线演示）；weknora 后端：REST 三端点。
 */
export function createKbClient(config, { fetchImpl = fetch, mockData = null } = {}) {
  const backend = text(config?.backend).trim()
  if (backend === 'mock') return createMockClient(mockData ?? { collections: [], hits: [], docs: {} })
  if (backend === 'weknora') return createWeKnoraClient(config, fetchImpl)
  return {
    backend: 'none',
    listCollections: async () => fail(KB_ERROR_CODES.KB_NOT_CONFIGURED, '还没接知识库：在设置里配 kb-config.json（backend/baseUrl/apiKey）'),
    query: async () => fail(KB_ERROR_CODES.KB_NOT_CONFIGURED, '还没接知识库'),
    doc: async () => fail(KB_ERROR_CODES.KB_NOT_CONFIGURED, '还没接知识库')
  }
}

function createWeKnoraClient(config, fetchImpl) {
  const baseUrl = text(config.baseUrl).trim()
  const apiKey = text(config.apiKey).trim()
  const spaceId = text(config.spaceId).trim()
  if (!baseUrl) {
    return createKbClient({ backend: 'none' })
  }
  // WeKnora 的 API key 走 X-API-Key 头（Bearer 是 JWT 会话的用法，二者不通）
  const headers = { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) }

  async function request(path, init = {}) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20000)
      })
    } catch (error) {
      return fail(KB_ERROR_CODES.KB_UNAVAILABLE, `知识库连不上（${baseUrl}）`)
    }
    if (response.status === 401 || response.status === 403) {
      return fail(KB_ERROR_CODES.KB_UNAUTHORIZED, `知识库拒绝访问（${response.status}）：检查 apiKey`)
    }
    if (!response.ok) {
      return fail(KB_ERROR_CODES.KB_UNAVAILABLE, `知识库返回 ${response.status}`)
    }
    try {
      return { ok: true, payload: await response.json() }
    } catch {
      return fail(KB_ERROR_CODES.KB_BAD_RESPONSE, '知识库响应不是 JSON')
    }
  }

  const withSpace = (path) => (spaceId ? `${path}${path.includes('?') ? '&' : '?'}space_id=${encodeURIComponent(spaceId)}` : path)

  return {
    backend: 'weknora',
    async listCollections() {
      // 真实端点（v0.9.0 路由）：GET /api/v1/knowledge-bases
      const result = await request(withSpace('/api/v1/knowledge-bases'))
      if (!result.ok) return result
      return { ok: true, collections: normalizeCollections(result.payload) }
    },
    async query({ collectionIds = [], query, topK = 6, minScore } = {}) {
      // 真实端点（v0.9.0）：POST /api/v1/knowledge-search
      // 请求体 SearchKnowledgeRequest：query / knowledge_base_ids[] / match_count / vector_threshold…
      const body = {
        query: text(query),
        knowledge_base_ids: collectionIds,
        match_count: Math.min(Number(topK) || 6, 12),
        ...(Number.isFinite(minScore) ? { vector_threshold: minScore } : {})
      }
      const result = await request('/api/v1/knowledge-search', { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) return result
      return { ok: true, hits: normalizeHits(result.payload), meta: result.payload?.meta ?? null }
    },
    async doc(id) {
      const result = await request(withSpace(`/api/v1/knowledge/${encodeURIComponent(text(id))}`))
      if (!result.ok) return result
      const payload = result.payload?.data ?? result.payload ?? {}
      return { ok: true, doc: { id: text(payload.id ?? id), title: text(payload.title ?? payload.name), source: text(payload.source), meta: payload.meta ?? {} } }
    }
  }
}

function createMockClient(mockData) {
  return {
    backend: 'mock',
    async listCollections() {
      return { ok: true, collections: mockData.collections }
    },
    async query({ collectionIds = [], query, topK = 6 } = {}) {
      const wanted = new Set(collectionIds)
      const hits = mockData.hits
        .filter((hit) => !wanted.size || wanted.has(hit.collection))
        .filter((hit) => !text(query).trim() || hit.text.includes(text(query).trim()) || hit.tags?.some((tag) => text(query).includes(tag)))
        .slice(0, Math.min(Number(topK) || 6, 12))
        .map(({ collection, tags, ...rest }) => rest)
      return { ok: true, hits }
    },
    async doc(id) {
      const doc = mockData.docs?.[text(id)]
      if (!doc) return fail(KB_ERROR_CODES.KB_BAD_RESPONSE, `mock 里没有这个文档：${text(id)}`)
      return { ok: true, doc }
    }
  }
}
