/** KnowledgeSearchService：API/MCP/Agent 唯一检索编排。 */
import { createHash } from 'node:crypto'
import { readKnowledgeLibraries, publicKnowledgeLibrary } from './knowledgeLibraryStore.mjs'
import { loadKnowledgeManifest, scanKnowledgeDocuments, computeIndexHash } from './knowledgeScanner.mjs'
import { deriveKnowledgeIndexState } from './knowledgeIndexState.mjs'
import { resolveKnowledgeDocument } from './knowledgePaths.mjs'

const MAX_HITS = 50
const cache = new Map()
let generation = 0

function fail(code, message, details) { return { ok: false, code, message, ...(details ? { details } : {}) } }
function text(value) { return String(value ?? '') }
function clip(textValue, max) {
  const body = text(textValue)
  return body.length > max ? `${body.slice(0, Math.max(0, max - 1))}…` : body
}

function canonicalHit(hit, context) {
  const ref = text(hit?.ref ?? hit?.documentRef ?? hit?.meta?.documentRef)
  const chunkId = text(hit?.chunkId ?? hit?.meta?.chunkId ?? hit?.id)
  return {
    libraryId: context.record.id,
    ref,
    title: text(hit?.title ?? hit?.source ?? ref),
    text: text(hit?.text ?? hit?.content),
    score: Number(hit?.score ?? hit?.distance ?? 0) || 0,
    source: text(hit?.source ?? context.provider),
    hash: text(hit?.hash ?? hit?.documentHash ?? hit?.meta?.documentHash),
    tags: Array.isArray(hit?.tags) ? hit.tags.map(text) : [],
    provenance: {
      contentRevision: context.contentRevision,
      indexHash: context.indexHash,
      engineVersion: context.runtimeVersion,
      documentRef: ref,
      chunkId,
      locator: text(hit?.locator ?? hit?.meta?.locator ?? chunkId),
      documentHash: text(hit?.documentHash ?? hit?.meta?.documentHash ?? hit?.hash)
    }
  }
}

function dedupeAndBudget(hits, budgetChars) {
  const seen = new Set()
  const output = []
  let used = 0
  for (const hit of hits) {
    const key = `${hit.libraryId}\0${hit.ref}\0${hit.provenance.chunkId || hit.provenance.locator}`
    if (seen.has(key)) continue
    seen.add(key)
    const remaining = Math.max(0, budgetChars - used)
    if (!remaining) break
    const next = { ...hit, text: clip(hit.text, remaining) }
    used += next.text.length
    output.push(next)
  }
  return output
}

function runtimeHealth(capability) {
  try { return capability?.health?.() ?? null } catch { return null }
}

export class KnowledgeSearchService {
  constructor({ env = process.env, host = null, resolveCapability = null, now = () => Date.now() } = {}) {
    this.env = env || process.env
    this.host = host || null
    this.resolveCapability = resolveCapability
    this.now = now
  }

  invalidate() { cache.clear(); generation += 1 }

  async library(libraryId = '') {
    const current = await readKnowledgeLibraries(this.host?.env || this.env)
    if (!current.ok) return current
    const record = libraryId ? current.table.libraries.find((item) => item.id === libraryId) : current.table.libraries.find((item) => item.id === current.table.activeLibraryId)
    if (!record) return fail('NOT_FOUND', libraryId ? `知识库不存在：${libraryId}` : '还没有激活知识库')
    if (!record.enabled) return fail('INVALID_ENTRY', `知识库已停用：${record.id}`)
    return { ok: true, record, table: current.table }
  }

  async context(libraryId = '', { capability = null } = {}) {
    const found = await this.library(libraryId)
    if (!found.ok) return found
    const record = found.record
    const loaded = await loadKnowledgeManifest(record.realRoot, record.manifest)
    if (!loaded.ok) return loaded
    const scanned = await scanKnowledgeDocuments(record.realRoot, loaded.manifest, record.customization)
    if (!scanned.ok && scanned.errors.some((error) => error.code === 'PATH_ESCAPE')) return fail('PATH_ESCAPE', '知识库源树含符号链接')
    const runtime = capability || (typeof this.resolveCapability === 'function' ? this.resolveCapability() : null)
    const health = runtimeHealth(runtime)
    const runtimeVersion = text(health?.version ?? health?.runtimeVersion ?? '')
    const index = deriveKnowledgeIndexState(record.index, { contentRevision: scanned.revision, runtimeVersion, runtimeAvailable: Boolean(runtime && health?.ok !== false) })
    const customizationHash = createHash('sha256').update(JSON.stringify(record.customization)).digest('hex')
    const indexHash = index.indexHash || computeIndexHash({ contentRevision: scanned.revision, manifestHash: loaded.hash, customizationHash, runtimeVersion, profileVersion: '1' })
    return { ok: true, record, manifest: loaded.manifest, manifestHash: loaded.hash, scanned, runtime, health, runtimeVersion, index, indexHash, contentRevision: scanned.revision }
  }

  async search({ libraryId = '', query, topK, minScore, budgetChars, signal = null } = {}) {
    const q = text(query).trim()
    if (!q) return fail('INVALID_ENTRY', 'query 必填')
    const ctx = await this.context(libraryId)
    if (!ctx.ok) return ctx
    const retrieval = { ...ctx.manifest.retrievalDefaults, ...ctx.record.customization.retrieval }
    const k = Math.min(MAX_HITS, Number.isInteger(topK) && topK > 0 ? topK : retrieval.topK)
    const threshold = Number.isFinite(minScore) ? minScore : retrieval.minScore
    const budget = Number.isInteger(budgetChars) && budgetChars > 0 ? budgetChars : retrieval.budgetChars
    if (!ctx.runtime) return fail('PLUGIN_DEGRADED', '知识库检索运行时未启用或不可用')
    if (ctx.health?.ok === false) return fail('RUNTIME_MISSING', text(ctx.health.message || '知识库运行时不可用'))
    if (ctx.index.status !== 'fresh') return fail(ctx.index.status === 'never-indexed' ? 'INDEX_NOT_READY' : 'STALE_INDEX', '知识库索引尚未就绪或已过期')
    const key = createHash('sha256').update(JSON.stringify({ generation, provider: 'hypergraphrag', libraryId: ctx.record.id, revision: ctx.contentRevision, indexHash: ctx.indexHash, profile: ctx.record.customization.retrieval, q, k, threshold, budget })).digest('hex')
    if (cache.has(key)) return cache.get(key)
    let raw
    try {
      raw = await ctx.runtime.query({ libraryId: ctx.record.id, query: q, topK: k, minScore: threshold, contentRevision: ctx.contentRevision, indexHash: ctx.indexHash, signal })
    } catch (error) {
      return fail(error?.code || 'RUNTIME_CRASHED', text(error?.message || error))
    }
    if (!raw?.ok) return raw
    const provider = text(raw.provider || ctx.health?.engine || 'hypergraphrag')
    const hits = dedupeAndBudget((Array.isArray(raw.hits) ? raw.hits : []).map((hit) => canonicalHit(hit, { ...ctx, provider })), budget)
    const result = { ok: true, hits, provider, provenance: { libraryId: ctx.record.id, contentRevision: ctx.contentRevision, indexHash: ctx.indexHash, engineVersion: ctx.runtimeVersion } }
    if (hits.length) cache.set(key, result)
    return result
  }

  async read({ libraryId = '', documentRef } = {}) {
    const ctx = await this.context(libraryId)
    if (!ctx.ok) return ctx
    const located = await resolveKnowledgeDocument(ctx.record.realRoot, documentRef)
    if (!located.ok) return located
    const document = ctx.scanned.files.find((file) => file.ref === located.ref)
    if (!document) return fail('NOT_FOUND', `知识库文档不存在：${located.ref}`)
    return { ok: true, document, backlinks: ctx.scanned.backlinks[located.ref] || { linked: [], unlinked: [] } }
  }

  async list() {
    const env = this.host?.env || this.env
    const current = await readKnowledgeLibraries(env)
    if (!current.ok) return current
    return { ok: true, libraries: current.table.libraries.map(publicKnowledgeLibrary), activeLibraryId: current.table.activeLibraryId }
  }
}
