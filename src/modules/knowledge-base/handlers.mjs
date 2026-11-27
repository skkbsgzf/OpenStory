/** 知识库工作台端点；handler 只做 HTTP/模块边界，业务留在本模块 store/scanner/service。 */
import { KnowledgeSearchService } from './knowledgeSearchService.mjs'
import {
  createEmptyKnowledgeLibrary, previewKnowledgeLibrary, publicKnowledgeLibrary,
  readKnowledgeLibraries, registerKnowledgeLibrary, setKnowledgeLibraryState
} from './knowledgeLibraryStore.mjs'
import { loadKnowledgeManifest, scanKnowledgeDocuments } from './knowledgeScanner.mjs'
import { resolveKnowledgeDocument } from './knowledgePaths.mjs'
import { deriveKnowledgeIndexState } from './knowledgeIndexState.mjs'

function sendFailure(res, sendError, failure) {
  return sendError(res, failure.code || 'INVALID_ENTRY', failure.message || '知识库操作失败', failure.details)
}
function runtimeHealth(runtime) {
  try { return runtime?.health?.() ?? null } catch (error) { return { ok: false, code: error?.code || 'RUNTIME_MISSING', message: error?.message || 'runtime health failed' } }
}

export function createHandlers({ host, service, runtimeProvider = () => null }) {
  const { sendError, sendJson, text } = host

  async function activeLibrary(ctx, libraryId) {
    const table = await readKnowledgeLibraries(ctx.context?.env ?? process.env)
    if (!table.ok) return table
    const record = table.table.libraries.find((item) => item.id === libraryId)
    if (!record) return { ok: false, code: 'NOT_FOUND', message: `知识库不存在：${libraryId}` }
    if (!record.enabled) return { ok: false, code: 'INVALID_ENTRY', message: `知识库已停用：${record.id}` }
    return { ok: true, record }
  }

  async function scanLibrary(ctx, libraryId) {
    const found = await activeLibrary(ctx, libraryId)
    if (!found.ok) return found
    const loaded = await loadKnowledgeManifest(found.record.realRoot, found.record.manifest)
    if (!loaded.ok) return loaded
    const scanned = await scanKnowledgeDocuments(found.record.realRoot, loaded.manifest, found.record.customization)
    if (!scanned.ok && scanned.errors.some((error) => error.code === 'PATH_ESCAPE')) return { ok: false, code: 'PATH_ESCAPE', message: '知识库源树含符号链接' }
    return { ok: true, record: found.record, loaded, scanned }
  }

  async function knowledgeLibrariesGet(ctx) {
    const env = ctx.context?.env || process.env
    const current = await readKnowledgeLibraries(env)
    const result = current.ok ? { ok: true, libraries: current.table.libraries.map(publicKnowledgeLibrary), activeLibraryId: current.table.activeLibraryId } : current
    return result.ok ? sendJson(ctx.res, 200, result) : sendFailure(ctx.res, sendError, result)
  }

  async function knowledgeLibraryPreview(ctx) {
    const result = await previewKnowledgeLibrary(ctx.request, ctx.context?.env ?? process.env)
    return result.ok ? sendJson(ctx.res, 200, result) : sendFailure(ctx.res, sendError, result)
  }

  async function knowledgeLibraryRegister(ctx) {
    const result = await registerKnowledgeLibrary(ctx.request, ctx.context?.env ?? process.env)
    if (!result.ok) return sendFailure(ctx.res, sendError, result)
    service.invalidate()
    return sendJson(ctx.res, 200, { ok: true, library: publicKnowledgeLibrary(result.library), operationId: result.operationId })
  }

  async function knowledgeLibraryCreate(ctx) {
    const result = await createEmptyKnowledgeLibrary(ctx.request, ctx.context?.env ?? process.env)
    if (!result.ok) return sendFailure(ctx.res, sendError, result)
    service.invalidate()
    const record = result.table.libraries.find((item) => item.id === ctx.request.id)
    return sendJson(ctx.res, 200, { ok: true, library: publicKnowledgeLibrary(record), operationId: result.operationId })
  }

  async function knowledgeLibraryStatePut(ctx) {
    const result = await setKnowledgeLibraryState(ctx.request.libraryId, { enabled: ctx.request.enabled, activate: ctx.request.activate }, ctx.context?.env ?? process.env)
    if (!result.ok) return sendFailure(ctx.res, sendError, result)
    service.invalidate()
    const record = result.table.libraries.find((item) => item.id === ctx.request.libraryId)
    return sendJson(ctx.res, 200, { ok: true, library: publicKnowledgeLibrary(record), activeLibraryId: result.table.activeLibraryId })
  }

  async function knowledgeLibraryCustomizationPut(ctx) {
    const result = await setKnowledgeLibraryState(ctx.request.libraryId, { customization: ctx.request.customization }, ctx.context?.env ?? process.env)
    if (!result.ok) return sendFailure(ctx.res, sendError, result)
    service.invalidate()
    const record = result.table.libraries.find((item) => item.id === ctx.request.libraryId)
    return sendJson(ctx.res, 200, { ok: true, library: publicKnowledgeLibrary(record) })
  }

  async function knowledgeDocumentsGet(ctx) {
    const scanned = await scanLibrary(ctx, ctx.request.libraryId)
    if (!scanned.ok) return sendFailure(ctx.res, sendError, scanned)
    const runtime = runtimeProvider()
    const health = runtimeHealth(runtime)
    const index = deriveKnowledgeIndexState(scanned.record.index, { contentRevision: scanned.scanned.revision, runtimeVersion: text(health?.version ?? health?.runtimeVersion ?? ''), runtimeAvailable: Boolean(runtime && health?.ok !== false) })
    return sendJson(ctx.res, 200, { ok: true, libraryId: scanned.record.id, documents: scanned.scanned.files, tags: scanned.scanned.tags, contentRevision: scanned.scanned.revision, indexStatus: index.status, graph: scanned.scanned.graph })
  }

  async function knowledgeDocumentGet(ctx) {
    const env = ctx.context?.env || process.env
    const current = await readKnowledgeLibraries(env)
    if (!current.ok) return sendFailure(ctx.res, sendError, current)
    const record = current.table.libraries.find((item) => item.id === ctx.request.libraryId)
    if (!record) return sendError(ctx.res, 'NOT_FOUND', `知识库不存在：${ctx.request.libraryId}`)
    if (!record.enabled) return sendError(ctx.res, 'INVALID_ENTRY', `知识库已停用：${record.id}`)
    const loaded = await loadKnowledgeManifest(record.realRoot, record.manifest)
    if (!loaded.ok) return sendFailure(ctx.res, sendError, loaded)
    const scanned = await scanKnowledgeDocuments(record.realRoot, loaded.manifest, record.customization)
    const located = await resolveKnowledgeDocument(record.realRoot, ctx.request.documentRef)
    if (!located.ok) return sendFailure(ctx.res, sendError, located)
    const document = scanned.files.find((file) => file.ref === located.ref)
    if (!document) return sendError(ctx.res, 'NOT_FOUND', `知识库文档不存在：${located.ref}`)
    return sendJson(ctx.res, 200, { ok: true, document, backlinks: scanned.backlinks[located.ref] || { linked: [], unlinked: [] } })
  }

  async function knowledgeGraphGet(ctx) {
    const scanned = await scanLibrary(ctx, ctx.request.libraryId)
    if (!scanned.ok) return sendFailure(ctx.res, sendError, scanned)
    return sendJson(ctx.res, 200, { ok: true, graph: scanned.scanned.graph })
  }

  async function knowledgeSearch(ctx) {
    const env = ctx.context?.env || process.env
    const current = await readKnowledgeLibraries(env)
    if (!current.ok) return sendFailure(ctx.res, sendError, current)
    const libraryId = text(ctx.request.libraryId || current.table.activeLibraryId || '')
    const runtime = runtimeProvider()
    if (!runtime) return sendError(ctx.res, 'PLUGIN_DEGRADED', '知识库检索运行时未启用或不可用')
    const service = new KnowledgeSearchService({ env, resolveCapability: () => runtime })
    const result = await service.search({ ...ctx.request, libraryId })
    return result.ok ? sendJson(ctx.res, 200, result) : sendFailure(ctx.res, sendError, result)
  }

  async function knowledgeIndexStatusGet(ctx) {
    const scanned = await scanLibrary(ctx, ctx.request.libraryId)
    if (!scanned.ok) return sendFailure(ctx.res, sendError, scanned)
    const runtime = runtimeProvider()
    let health = null
    try { health = runtime?.health?.() ?? null } catch (error) { health = { ok: false, code: error?.code || 'RUNTIME_MISSING', message: error?.message || 'runtime health failed' } }
    const runtimeVersion = text(health?.version ?? health?.runtimeVersion ?? '')
    const index = deriveKnowledgeIndexState(scanned.record.index, { contentRevision: scanned.scanned.revision, runtimeVersion, runtimeAvailable: Boolean(runtime && health?.ok !== false) })
    return sendJson(ctx.res, 200, { ok: true, libraryId: scanned.record.id, index, contentRevision: scanned.scanned.revision, runtime: { available: Boolean(runtime), version: runtimeVersion, health } })
  }

  async function knowledgeIndexSync(ctx) {
    if (ctx.request.confirm !== true) return sendError(ctx.res, 'CONFIRM_REQUIRED', '同步知识库索引必须明确确认')
    const scanned = await scanLibrary(ctx, ctx.request.libraryId)
    if (!scanned.ok) return sendFailure(ctx.res, sendError, scanned)
    const runtime = runtimeProvider()
    if (!runtime) return sendError(ctx.res, 'PLUGIN_DEGRADED', '知识库检索运行时未启用或不可用')
    const health = runtime.health?.()
    if (health?.ok === false) return sendError(ctx.res, 'RUNTIME_MISSING', text(health.message || '知识库运行时不可用'))
    const result = await runtime.insert({ libraryId: scanned.record.id, root: scanned.record.realRoot, manifest: scanned.loaded.manifest, documents: scanned.scanned.files, contentRevision: scanned.scanned.revision })
    if (!result?.ok) return sendFailure(ctx.res, sendError, result)
    return sendJson(ctx.res, 200, { ok: true, operationId: text(result.operationId), index: result.index || { status: 'fresh', contentRevision: scanned.scanned.revision, indexHash: text(result.indexHash) } })
  }

  return {
    knowledgeLibrariesGet, knowledgeLibraryPreview, knowledgeLibraryRegister, knowledgeLibraryCreate,
    knowledgeLibraryStatePut, knowledgeLibraryCustomizationPut, knowledgeDocumentsGet,
    knowledgeDocumentGet, knowledgeGraphGet, knowledgeSearch, knowledgeIndexStatusGet, knowledgeIndexSync
  }
}
