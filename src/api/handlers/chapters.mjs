/**
 * chapters 域 handler（OS-141 daemon 拆分）——12 端点，与 contracts/chapters.mjs 一一对应：
 * chapterGet/chapterPut（正文读·原子写）、chaptersGet/chaptersCreate/chaptersRename/chapterDelete（章层面）、
 * changeLogGet/changeLogEntry/changeLogRestore/changeLogSummary（变更日志）、draftGet/draftPut（草稿）。
 *
 * 统一签名 `async handler(ctx)`：全部端点都需要库，第一件事 authorizeRoot。
 */
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { API_ERROR_CODES, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, resolveInsideRoot } from '../../host/authorize.mjs'
import { listChapters, createChapter, renameChapter, deleteChapter } from '../../protocol/chapters.mjs'
import { readChange, readLog, logSummary } from '../../protocol/changelog.mjs'
import { writeChapterWithBackup } from '../../protocol/chapterWrite.mjs'
import { dropDraft, listDrafts, loadDraft, saveDraft } from '../../protocol/libState.mjs'
import { factHealth } from '../../protocol/factGuard.mjs'
import { suiteValue } from '../../services/suites.mjs'

export async function chapterGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const resolved = resolveInsideRoot(authorized.root, request.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let body
  try {
    const stats = statSync(resolved.path)
    if (!stats.isFile()) return sendError(res, API_ERROR_CODES.NOT_FOUND, '正文路径不是文件', { file: request.file })
    body = await readFile(resolved.path, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文文件不存在：${request.file}`, { file: request.file })
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文读取失败：${text(error?.message || error)}`, { file: request.file })
  }
  return sendJson(res, 200, { ok: true, name: basename(resolved.path), text: body, chars: body.length })
}

export async function chapterPut(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const written = await writeChapterWithBackup(authorized.root, request.file, request.text)
  if (!written.ok) return sendError(res, written.code, written.message, written.details)
  // FACT-FIRST 规则 5：正文写入**不**隐式触发事实链重建（重建要跑模型、要花钱），
  // 但必须如实告诉调用方「这本书的事实链已落后于正文」，由 UI 决定提示还是自动重跑。
  const health = await factHealth(authorized.root).catch(() => null)
  return sendJson(res, 200, {
    ok: true,
    chars: written.chars,
    savedAt: written.savedAt,
    ...(written.backup ? { backup: written.backup } : {}),
    // OS-89：把变更 id 透传给前端（有 diff 就有 id，可用于「查看这次改了什么」）
    ...(written.changeId ? { changeId: written.changeId } : {}),
    ...(written.logError ? { logError: written.logError } : {}),
    ...(health ? { factStale: health.stale, factEntries: health.entries } : {})
  })
}

export async function chaptersGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const listed = await listChapters(authorized.root, request.dir)
  if (!listed.ok) return sendError(res, listed.code ?? API_ERROR_CODES.INVALID_ENTRY, listed.message, listed.details)
  return sendJson(res, 200, { ok: true, chapters: listed.chapters, ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) })
}

export async function chaptersCreate(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  // title 缺省＝用写作套件的「新建章节默认标题」（套件停用＝无默认，createChapter 自行拒绝）
  const defaultTitle = text(request.title).trim()
    || text(await suiteValue(context.suitesDirs, context.suiteStatePath, 'writing', 'newChapterTitle', ''))
  const created = await createChapter(authorized.root, request.dir, defaultTitle)
  if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message, created.details)
  return sendJson(res, 200, { ok: true, chapter: created.chapter })
}

export async function chaptersRename(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const renamed = await renameChapter(authorized.root, request.file, request.title)
  if (!renamed.ok) return sendError(res, renamed.code ?? API_ERROR_CODES.INVALID_ENTRY, renamed.message, renamed.details)
  return sendJson(res, 200, { ok: true, chapter: renamed.chapter, ...(renamed.previousFile ? { previousFile: renamed.previousFile } : {}) })
}

export async function chapterDelete(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const deleted = await deleteChapter(authorized.root, request.file)
  if (!deleted.ok) return sendError(res, deleted.code ?? API_ERROR_CODES.INVALID_ENTRY, deleted.message, deleted.details)
  return sendJson(res, 200, { ok: true, backup: deleted.backup })
}

/* ---------- OS-89：变更日志 / 界面状态 / 草稿（全部落库内本地文件） ---------- */

export async function changeLogGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await readLog({
    root: authorized.root,
    module: text(request.module),
    file: text(request.file),
    limit: Number(request.limit) || 50
  })
  return sendJson(res, 200, { ok: true, entries: result.entries ?? [], truncated: result.truncated === true })
}

export async function changeLogEntry(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await readChange({
    root: authorized.root,
    module: text(request.module),
    at: text(request.at),
    afterHash: text(request.afterHash)
  })
  if (!result.ok) return sendError(res, API_ERROR_CODES.NOT_FOUND, '找不到这条变更记录')
  return sendJson(res, 200, { ok: true, entry: result.entry })
}

export async function changeLogRestore(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const found = await readChange({
    root: authorized.root,
    module: text(request.module),
    at: text(request.at),
    afterHash: text(request.afterHash)
  })
  if (!found.ok) return sendError(res, API_ERROR_CODES.NOT_FOUND, '找不到这条变更记录')
  const entry = found.entry
  if (!entry?.backup) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY,
      '这条变更没有留下可恢复的备份（新建类变更回退不了）')
  }
  // 1) 读备份内容
  const backupAbs = resolveInsideRoot(authorized.root, entry.backup, { allowMetadata: true })
  if (!backupAbs.ok) return sendError(res, backupAbs.code, backupAbs.message, backupAbs.details)
  let beforeText
  try { beforeText = await readFile(backupAbs.path, 'utf-8') } catch (error) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `备份文件读不到：${text(error?.message || error)}`)
  }
  // 2) 先给当前内容做一次安全备份（这次恢复本身也要可回退），再写回
  const written = await writeChapterWithBackup(authorized.root, entry.file, beforeText, {
    module: entry.module,
    actor: 'author',
    meta: { restoredFrom: entry.backup, restoredAt: entry.at }
  })
  if (!written.ok) return sendError(res, written.code, written.message, written.details)
  return sendJson(res, 200, {
    ok: true,
    file: entry.file,
    restoredFrom: entry.backup,
    ...(written.backup ? { safetyBackup: written.backup } : {})
  })
}

export async function changeLogSummary(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await logSummary(authorized.root)
  return sendJson(res, 200, { ok: true, modules: result.modules ?? [] })
}

export async function draftGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const mod = text(request.module)
  if (!mod) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'module 必填')
  const wantedId = text(request.id)
  if (wantedId) {
    const result = await loadDraft(authorized.root, mod, wantedId)
    return sendJson(res, 200, { ok: true, draft: result.draft ?? null })
  }
  const listed = await listDrafts(authorized.root, mod)
  return sendJson(res, 200, { ok: true, drafts: listed.drafts ?? [] })
}

export async function draftPut(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const mod = text(request.module)
  const id = text(request.id)
  if (!mod || !id) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'module 与 id 必填')
  if (request.delete === true) {
    const dropped = await dropDraft(authorized.root, mod, id)
    if (!dropped.ok) return sendError(res, dropped.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, dropped.message)
    return sendJson(res, 200, { ok: true, draft: null })
  }
  const saved = await saveDraft(authorized.root, { module: mod, id, text: text(request.text), meta: request.meta })
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
  return sendJson(res, 200, { ok: true, draft: saved.draft })
}

/** chapters 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  chapterGet,
  chapterPut,
  chaptersGet,
  chaptersCreate,
  chaptersRename,
  chapterDelete,
  changeLogGet,
  changeLogEntry,
  changeLogRestore,
  changeLogSummary,
  draftGet,
  draftPut
}
