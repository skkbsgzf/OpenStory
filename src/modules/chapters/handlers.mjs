/**
 * chapters 端点 handler（OS-194 从 src/api/handlers/chapters.mjs 归位 7 个独占端点；
 * changeLog*4 与 draftPut 是宿主共享端点，仍留 src/api/handlers/chapters.mjs）。
 *
 * 内核 prose 句柄经 activate(context) 的 context.resolve('prose.write') 注入，
 * 宿主工具经 context.host 注入；本文件只 import node:/protocol。
 */
import { listDrafts, loadDraft } from '../../protocol/libState.mjs'
import { factHealth } from '../../protocol/factGuard.mjs'

export function createHandlers({ host, prose }) {
  const { apiErrors, sendError, sendJson, text, authorizeRoot, suiteValue } = host

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
    const written = await prose.writeChapterWithBackup(authorized.root, request.file, request.text)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    // FACT-FIRST 规则 5：正文写入**不**隐式触发事实链重建（重建要跑模型、要花钱），
    // 但必须如实告诉调用方「这本书的事实链已落后于正文」，由 UI 决定提示还是自动重跑。
    const health = await factHealth(authorized.root).catch(() => null)
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
    const renamed = await prose.renameChapter(authorized.root, request.file, request.title)
    if (!renamed.ok) return sendError(res, renamed.code ?? apiErrors.INVALID_ENTRY, renamed.message, renamed.details)
    return sendJson(res, 200, { ok: true, chapter: renamed.chapter, ...(renamed.previousFile ? { previousFile: renamed.previousFile } : {}) })
  }

  async function chapterDelete(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
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
