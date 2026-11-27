/** 机器级知识库清单、预览/确认、定制与元数据日志（OS-226）。 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { courtyardPath } from '../../protocol/courtyard.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { canonicalKnowledgeRoot } from './knowledgePaths.mjs'
import { loadKnowledgeManifest, scanKnowledgeDocuments } from './knowledgeScanner.mjs'
import { emptyKnowledgeIndex, validateKnowledgeIndexState } from './knowledgeIndexState.mjs'

export const KNOWLEDGE_LIBRARY_SPEC = 'openstory.knowledge-library@1'
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const text = (value) => String(value ?? '')
const previews = new Map()

export function knowledgeLibrariesPath(env = process.env) { return courtyardPath(env, 'openstory', 'knowledge-libraries.json') }
export function knowledgeHistoryDir(env = process.env) { return courtyardPath(env, 'openstory', 'knowledge', 'history') }
export function knowledgeLogDir(env = process.env) { return courtyardPath(env, 'openstory', 'knowledge', 'log') }

function fail(code, message, details) { return { ok: false, code, message, ...(details ? { details } : {}) } }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function normalizedPath(value) { return text(value).replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase() }
function now() { return new Date().toISOString() }

function normalizeCustomization(value) {
  const input = plain(value) ? value : {}
  const retrieval = plain(input.retrieval) ? input.retrieval : {}
  return {
    displayName: text(input.displayName).trim(),
    description: text(input.description).trim(),
    tags: Array.isArray(input.tags) ? input.tags.map(text).filter(Boolean) : [],
    nodeMap: plain(input.nodeMap) ? Object.fromEntries(Object.entries(input.nodeMap).filter(([, v]) => typeof v === 'string')) : {},
    edgeMap: plain(input.edgeMap) ? Object.fromEntries(Object.entries(input.edgeMap).filter(([, v]) => typeof v === 'string')) : {},
    exclude: Array.isArray(input.exclude) ? input.exclude.map(text).filter(Boolean) : [],
    retrieval: {
      topK: Number.isInteger(retrieval.topK) && retrieval.topK > 0 && retrieval.topK <= 50 ? retrieval.topK : 6,
      minScore: Number.isFinite(retrieval.minScore) && retrieval.minScore >= 0 && retrieval.minScore <= 1 ? retrieval.minScore : 0.3,
      budgetChars: Number.isInteger(retrieval.budgetChars) && retrieval.budgetChars > 0 ? retrieval.budgetChars : 6000
    }
  }
}

export function normalizeKnowledgeLibraries(raw) {
  if (!plain(raw) || raw.schema !== KNOWLEDGE_LIBRARY_SPEC || raw.schemaVersion !== 1 || !Array.isArray(raw.libraries)) {
    return fail('KNOWLEDGE_LIBRARY_CORRUPT', '知识库清单形状损坏，拒绝覆盖')
  }
  const libraries = []
  const ids = new Set()
  const roots = new Set()
  for (const item of raw.libraries) {
    if (!plain(item) || typeof item.id !== 'string' || !ID_RE.test(item.id) || !text(item.root).trim()) return fail('KNOWLEDGE_LIBRARY_CORRUPT', '知识库清单条目形状损坏')
    if (ids.has(item.id)) return fail('KNOWLEDGE_LIBRARY_CORRUPT', `重复知识库 id：${item.id}`)
    const realKey = normalizedPath(item.realRoot || item.root)
    if (roots.has(realKey)) return fail('KNOWLEDGE_LIBRARY_CORRUPT', `重复知识库根：${item.root}`)
    ids.add(item.id)
    roots.add(realKey)
    libraries.push({
      id: item.id, name: text(item.name).trim(), description: text(item.description).trim(),
      source: ['seed', 'local'].includes(item.source) ? item.source : 'local',
      root: text(item.root), realRoot: text(item.realRoot || item.root), manifest: text(item.manifest || 'knowledge.base.json'),
      manifestSha256: text(item.manifestSha256), contentRevision: text(item.contentRevision), enabled: item.enabled !== false,
      createdAt: text(item.createdAt), updatedAt: text(item.updatedAt),
      customization: normalizeCustomization(item.customization),
      index: validateKnowledgeIndexState(item.index) ? { ...emptyKnowledgeIndex(), ...item.index } : emptyKnowledgeIndex()
    })
  }
  const active = raw.activeLibraryId ?? null
  if (active !== null && !libraries.some((item) => item.id === active && item.enabled)) return fail('KNOWLEDGE_LIBRARY_CORRUPT', 'activeLibraryId 指向不存在或停用的知识库')
  return { ok: true, table: { schema: KNOWLEDGE_LIBRARY_SPEC, schemaVersion: 1, activeLibraryId: active, libraries } }
}

export async function readKnowledgeLibraries(env = process.env, { path = knowledgeLibrariesPath(env) } = {}) {
  if (!existsSync(path)) return { ok: true, path, table: { schema: KNOWLEDGE_LIBRARY_SPEC, schemaVersion: 1, activeLibraryId: null, libraries: [] } }
  let raw
  try { raw = JSON.parse(await readFile(path, 'utf8')) } catch (error) { return fail('KNOWLEDGE_LIBRARY_CORRUPT', `知识库清单读不了：${error.message}`) }
  const normalized = normalizeKnowledgeLibraries(raw)
  return normalized.ok ? { ok: true, path, table: normalized.table } : normalized
}

export async function snapshotKnowledgeLibraries(path, env = process.env, operationId = randomUUID()) {
  const target = `${knowledgeHistoryDir(env)}/${operationId}`
  await mkdir(target, { recursive: true })
  const backup = `${target}/knowledge-libraries.before.json`
  try { await writeFile(backup, await readFile(path)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  return backup
}

export async function appendKnowledgeLog(env, entry) {
  const dir = knowledgeLogDir(env)
  await mkdir(dir, { recursive: true })
  const file = `${dir}/${now().slice(0, 7)}.jsonl`
  await writeFile(file, `${JSON.stringify({ at: now(), actor: 'author', ...entry })}\n`, { flag: 'a' })
}

export async function writeKnowledgeLibraries(next, env = process.env, { operationId = randomUUID() } = {}) {
  const normalized = normalizeKnowledgeLibraries(next)
  if (!normalized.ok) return normalized
  const path = knowledgeLibrariesPath(env)
  const current = await readKnowledgeLibraries(env)
  if (!current.ok) return current
  await snapshotKnowledgeLibraries(path, env, operationId)
  await mkdir(dirname(path), { recursive: true })
  await atomicWriteFile(path, `${JSON.stringify(normalized.table, null, 2)}\n`)
  await appendKnowledgeLog(env, { op: 'write', operationId, activeLibraryId: normalized.table.activeLibraryId, libraries: normalized.table.libraries.map((item) => item.id) })
  return { ok: true, path, table: normalized.table, operationId }
}

export async function previewKnowledgeLibrary(input, env = process.env) {
  const root = await canonicalKnowledgeRoot(input?.root)
  if (!root.ok) return root
  const loaded = await loadKnowledgeManifest(root.path, input?.manifest || 'knowledge.base.json')
  if (!loaded.ok) return loaded
  const current = await readKnowledgeLibraries(env)
  if (!current.ok) return current
  if (current.table.libraries.some((item) => normalizedPath(item.realRoot) === normalizedPath(root.realRoot))) return fail('INVALID_ENTRY', '这个知识库根已经登记')
  const customization = normalizeCustomization(input?.customization)
  const scanned = await scanKnowledgeDocuments(root.realRoot, loaded.manifest, customization)
  if (!scanned.ok && scanned.errors.some((error) => error.code === 'PATH_ESCAPE')) return fail('PATH_ESCAPE', '知识库源树含符号链接，拒绝登记', { errors: scanned.errors })
  const documentEntry = scanned.files.find((file) => file.ref === loaded.manifest.documentEntry)
  if (!documentEntry) return fail('INVALID_ENTRY', 'manifest.documentEntry 不在可扫描文档中')
  const id = text(input?.id || loaded.manifest.id).trim()
  if (!ID_RE.test(id)) return fail('INVALID_ENTRY', '知识库 id 必须是稳定小写 slug')
  if (current.table.libraries.some((item) => item.id === id)) return fail('INVALID_ENTRY', `知识库 id 已存在：${id}`)
  const previewId = randomUUID()
  const fingerprint = createHash('sha256').update(JSON.stringify({ root: root.realRoot, manifest: loaded.hash, revision: scanned.revision, exclude: customization.exclude })).digest('hex')
  previews.set(previewId, { env, fingerprint, id, root, manifest: loaded.manifest, manifestSha256: loaded.hash, customization, revision: scanned.revision, documentCount: scanned.files.length, createdAt: now() })
  return {
    ok: true, previewId, fingerprint,
    preview: { id, name: text(input?.name || loaded.manifest.name), description: text(input?.description || ''), root: root.path, realRoot: root.realRoot, manifest: loaded.manifest, documentCount: scanned.files.length, contentRevision: scanned.revision, errors: scanned.errors }
  }
}

export async function registerKnowledgeLibrary({ previewId, confirm = false } = {}, env = process.env) {
  if (confirm !== true) return fail('CONFIRM_REQUIRED', '登记知识库必须明确确认')
  const pending = previews.get(String(previewId || ''))
  if (!pending || pending.env !== env) return fail('PLAN_NOT_FOUND', '登记预览不存在或已过期')
  const current = await readKnowledgeLibraries(env)
  if (!current.ok) return current
  const loaded = await loadKnowledgeManifest(pending.root.path, 'knowledge.base.json')
  if (!loaded.ok || loaded.hash !== pending.manifestSha256) return fail('PLAN_STALE', '预览后 manifest 已变化')
  const scanned = await scanKnowledgeDocuments(pending.root.realRoot, pending.manifest, pending.customization)
  if (scanned.revision !== pending.revision) return fail('PLAN_STALE', '预览后知识库内容已变化')
  if (current.table.libraries.some((item) => item.id === pending.id || normalizedPath(item.realRoot) === normalizedPath(pending.root.realRoot))) return fail('PLAN_STALE', '预览后知识库清单已变化')
  const at = now()
  const record = {
    id: pending.id, name: text(pending.manifest.name), description: '', source: 'local',
    root: pending.root.path, realRoot: pending.root.realRoot, manifest: 'knowledge.base.json',
    manifestSha256: pending.manifestSha256, contentRevision: pending.revision, enabled: true,
    createdAt: at, updatedAt: at, customization: pending.customization, index: emptyKnowledgeIndex()
  }
  const table = { ...current.table, activeLibraryId: current.table.activeLibraryId ?? record.id, libraries: [...current.table.libraries, record] }
  const written = await writeKnowledgeLibraries(table, env)
  if (written.ok) previews.delete(previewId)
  return written.ok ? { ok: true, library: written.table.libraries.find((item) => item.id === record.id), operationId: written.operationId } : written
}

export async function setKnowledgeLibraryState(id, patch, env = process.env) {
  const current = await readKnowledgeLibraries(env)
  if (!current.ok) return current
  const index = current.table.libraries.findIndex((item) => item.id === id)
  if (index < 0) return fail('NOT_FOUND', `知识库不存在：${id}`)
  const libraries = current.table.libraries.map((item) => ({ ...item, customization: { ...item.customization } }))
  const record = libraries[index]
  if (patch.enabled !== undefined) record.enabled = patch.enabled === true
  if (patch.activate === true) record.enabled = true
  if (patch.customization !== undefined) record.customization = normalizeCustomization({ ...record.customization, ...patch.customization, retrieval: { ...record.customization.retrieval, ...(patch.customization?.retrieval || {}) } })
  record.updatedAt = now()
  let activeLibraryId = current.table.activeLibraryId
  if (patch.activate === true) activeLibraryId = id
  if (record.enabled === false && activeLibraryId === id) activeLibraryId = libraries.find((item) => item.id !== id && item.enabled)?.id ?? null
  return writeKnowledgeLibraries({ ...current.table, activeLibraryId, libraries }, env)
}

export async function createEmptyKnowledgeLibrary({ id, name, root }, env = process.env) {
  if (!ID_RE.test(text(id))) return fail('INVALID_ENTRY', '知识库 id 必须是稳定小写 slug')
  const located = await canonicalKnowledgeRoot(root)
  if (!located.ok) return located
  const current = await readKnowledgeLibraries(env)
  if (!current.ok) return current
  if (current.table.libraries.some((item) => item.id === id || normalizedPath(item.realRoot) === normalizedPath(located.realRoot))) return fail('INVALID_ENTRY', '知识库 id 或根已存在')
  const at = now()
  const record = { id, name: text(name || id), description: '', source: 'local', root: located.path, realRoot: located.realRoot, manifest: 'knowledge.base.json', manifestSha256: '', contentRevision: '', enabled: true, createdAt: at, updatedAt: at, customization: normalizeCustomization({}), index: emptyKnowledgeIndex() }
  return writeKnowledgeLibraries({ ...current.table, activeLibraryId: current.table.activeLibraryId ?? id, libraries: [...current.table.libraries, record] }, env)
}

export function publicKnowledgeLibrary(record) {
  if (!record) return null
  const { root: _root, realRoot: _realRoot, ...safe } = record
  return { ...safe, rootRegistered: true }
}
