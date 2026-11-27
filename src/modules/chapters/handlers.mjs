/**
 * chapters 端点 handler（OS-194 从 src/api/handlers/chapters.mjs 归位 7 个独占端点；
 * changeLog*4 与 draftPut 是宿主共享端点，仍留 src/api/handlers/chapters.mjs）。
 *
 * 内核 prose 句柄经 activate(context) 的 context.resolve('prose.write') 注入，
 * 宿主工具经 context.host 注入；本文件只 import node:/protocol。
 *
 * OS-211 写边界：四个写真端点（chapterPut／chaptersCreate／chaptersRename／chapterDelete）
 * 一律先过 `prose.assertCarrierWrite`——只许落载体目录（正文／剧本）。`故事源/` 走 fact
 * 写协议（schema/revision/operationId），`世界书/` 走世界书专用端点（referenceNotePut），
 * `.openstory/` 归宿主写通道；MCP 与直接 HTTP 都过同一道闸（MCP 只是 daemon 的薄适配）。
 */
import { listDrafts, loadDraft } from '../../protocol/libState.mjs'

export function createHandlers({ host, prose }) {
  const { apiErrors, sendError, sendJson, text, authorizeRoot, suiteValue } = host

  /** 写边界拦下＝INVALID_ENTRY（400），details 带允许的载体目录清单。 */
  function rejectOutsideCarrier(res, file) {
    const guarded = prose.assertCarrierWrite(file)
    if (!guarded.ok) sendError(res, guarded.code ?? apiErrors.INVALID_ENTRY, guarded.message, guarded.details)
    return guarded.ok
  }

  async function chapterGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const chapter = await prose.readChapter(authorized.root, request.file)
    if (!chapter.ok) return sendError(res, chapter.code, chapter.message, chapter.details)
    return sendJson(res, 200, chapter)
  }

  async function chapterPut(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    if (!rejectOutsideCarrier(res, request.file)) return null
    const written = await prose.writeChapterWithBackup(authorized.root, request.file, request.text)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    // FACT-FIRST 规则 5：正文写入**不**隐式触发事实链重建（重建要跑模型、要花钱），
    // 但必须如实告诉调用方「这本书的事实链已落后于正文」，由 UI 决定提示还是自动重跑。
    const health = await prose.factHealth(authorized.root).catch(() => null)
    return sendJson(res, 200, {
      ok: true,
      chars: written.chars,
      savedAt: written.savedAt,
      ...(written.backup ? { backup: written.backup } : {}),
      ...(written.changeId ? { changeId: written.changeId } : {}),
      ...(written.logError ? { logError: written.logError } : {}),
      ...(health ? { factStale: health.stale, factEntries: health.entries } : {})
    })
  }

  async function chaptersGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const listed = await prose.listChapters(authorized.root, request.dir)
    if (!listed.ok) return sendError(res, listed.code ?? apiErrors.INVALID_ENTRY, listed.message, listed.details)
    return sendJson(res, 200, { ok: true, chapters: listed.chapters, ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) })
  }

  async function chaptersCreate(ctx) {
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    // OS-211：新建也受载体目录约束（dir 就是章节落点目录）。
    if (!rejectOutsideCarrier(res, `${text(request.dir).replace(/[\\/]+$/u, '')}/_.md`)) return null
    // title 缺省＝用写作套件的「新建章节默认标题」（套件停用＝无默认，createChapter 自行拒绝）
    const defaultTitle = text(request.title).trim()
      || text(await suiteValue(context.suitesDirs, context.suiteStatePath, 'writing', 'newChapterTitle', '', authorized.root))
    const created = await prose.createChapter(authorized.root, request.dir, defaultTitle)
    if (!created.ok) return sendError(res, created.code ?? apiErrors.INVALID_ENTRY, created.message, created.details)
    return sendJson(res, 200, { ok: true, chapter: created.chapter })
  }

  async function chaptersRename(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    if (!rejectOutsideCarrier(res, request.file)) return null
    const renamed = await prose.renameChapter(authorized.root, request.file, request.title)
    if (!renamed.ok) return sendError(res, renamed.code ?? apiErrors.INVALID_ENTRY, renamed.message, renamed.details)
    return sendJson(res, 200, { ok: true, chapter: renamed.chapter, ...(renamed.previousFile ? { previousFile: renamed.previousFile } : {}) })
  }

  async function chapterDelete(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    if (!rejectOutsideCarrier(res, request.file)) return null
    const deleted = await prose.deleteChapter(authorized.root, request.file)
    if (!deleted.ok) return sendError(res, deleted.code ?? apiErrors.INVALID_ENTRY, deleted.message, deleted.details)
    return sendJson(res, 200, { ok: true, backup: deleted.backup })
  }

  async function draftGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const mod = text(request.module)
    if (!mod) return sendError(res, apiErrors.INVALID_ENTRY, 'module 必填')
    const wantedId = text(request.id)
    if (wantedId) {
      const result = await loadDraft(authorized.root, mod, wantedId)
      return sendJson(res, 200, { ok: true, draft: result.draft ?? null })
    }
    const listed = await listDrafts(authorized.root, mod)
    return sendJson(res, 200, { ok: true, drafts: listed.drafts ?? [] })
  }

  return { chapterGet, chapterPut, chaptersGet, chaptersCreate, chaptersRename, chapterDelete, draftGet }
}
