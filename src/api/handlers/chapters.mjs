/**
 * chapters 域 handler（OS-141 daemon 拆分）——12 端点，与 contracts/chapters.mjs 一一对应：
 * chapterGet/chapterPut（正文读·原子写）、chaptersGet/chaptersCreate/chaptersRename/chapterDelete（章层面）、
 * changeLogGet/changeLogEntry/changeLogRestore/changeLogSummary（变更日志）、draftGet/draftPut（草稿）。
 *
 * 统一签名 `async handler(ctx)`：全部端点都需要库，第一件事 authorizeRoot。
 */
import { API_ERROR_CODES } from '../contracts.mjs'
import { readFile } from 'node:fs/promises'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot } from '../../host/authorize.mjs'
import { readChange, readLog, logSummary } from '../../protocol/changelog.mjs'
import { resolveProseCapability } from '../../host/capabilityBindings.mjs'
import { dropDraft, saveDraft } from '../../protocol/libState.mjs'
async function proseCapabilityOrError(res, root) {
  const resolved = await resolveProseCapability(root)
  if (!resolved.ok) {
    sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, resolved.message, resolved.details)
    return null
  }
  return resolved.capability
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
  const prose = await proseCapabilityOrError(res, authorized.root)
  if (!prose) return null
  const written = await prose.writeChapterWithBackup(authorized.root, entry.file, beforeText, {
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

  changeLogGet,
  changeLogEntry,
  changeLogRestore,
  changeLogSummary,
  draftPut
}
