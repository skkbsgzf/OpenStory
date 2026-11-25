/**
 * library 域 handler（OS-141 daemon 拆分）——6 端点，与 contracts/library.mjs 一一对应：
 * libraries（库清单上屏）、libraryDiagnose/libraryScan/libraryImport/libraryPrimary（诊断·扫描·导入·主载体）、
 * libraryCreate（新建并登记）。
 *
 * 统一签名 `async handler(ctx)`，ctx = { req, res, url, request, context, allowlist, loaded }：
 * libraries 在 daemon 输入解析之前接走（ctx 无 request，直接用 ctx.loaded 的读盘结果）；
 * libraryCreate 不做 root 授权（它自己写库清单）；其余端点第一件事 authorizeRoot。
 */
import { basename } from 'node:path'
import { API_ERROR_CODES, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, canonicalRoot, rootKey } from '../../host/authorize.mjs'
import { createLibrary, diagnoseLibrary, importLibrary, scanLibrary, setPrimaryCarrier } from '../../host/libraryManage.mjs'

/** --root 显式授权的库不在库清单里时也上屏，作者才能点得到。 */
function mergeLibraryRoots(libraries, extraRoots) {
  const list = [...libraries]
  const seen = new Set(libraries.map((library) => rootKey(library.path)))
  for (const extra of extraRoots) {
    const root = canonicalRoot(extra)
    if (!root) continue
    const key = rootKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ path: root, name: basename(root) || root, kind: '未分类', count: 0, at: '' })
  }
  return list
}

/* 库清单上屏：在 daemon 输入解析之前响应（不收请求体），直接用路由层读好的库清单。 */
export async function libraries(ctx) {
  const { res, context, loaded } = ctx
  const merged = mergeLibraryRoots(loaded.libraries, context.extraRoots)
  const defaultRecord = context.defaultRoot
    ? merged.find((library) => rootKey(library.path) === rootKey(context.defaultRoot))
    : null
  const payload = {
    ok: true,
    libraries: merged,
    warnings: loaded.warnings,
    preferencesPath: loaded.preferencesPath,
    ...(context.defaultRoot ? { defaultRoot: defaultRecord?.path ?? context.defaultRoot } : {})
  }
  const checked = validateResponse('libraries', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '库清单响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

export async function libraryDiagnose(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const diagnosed = await diagnoseLibrary(authorized.root)
  if (!diagnosed.ok) return sendError(res, diagnosed.code ?? API_ERROR_CODES.INVALID_ENTRY, diagnosed.message)
  if (ctx.libraryUpgrade?.upgraded) {
    diagnosed.shape.upgrade = ctx.libraryUpgrade.report
    diagnosed.verdict.detail += `；已一次性升级，冲突 ${ctx.libraryUpgrade.report.conflicts.length} 项，备份 ${ctx.libraryUpgrade.report.backup}`
  }
  return sendJson(res, 200, { ok: true, shape: diagnosed.shape, verdict: diagnosed.verdict })
}

export async function libraryCreate(ctx) {
  const { res, request, loaded } = ctx
  if (loaded.warnings?.some((warning) => warning.code === 'PREFERENCES_SHAPE')) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '当前库清单不是本产品形状，只读不覆盖；请改用 OpenStory 自持库清单后再建库')
  }
  const created = await createLibrary({ ...request, preferencesPath: loaded.preferencesPath })
  if (!created.ok) {
    return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message, created.details)
  }
  return sendJson(res, 200, created)
}

export async function libraryScan(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const scanned = await scanLibrary({ root: authorized.root, sourcePath: request.sourcePath })
  if (!scanned.ok) return sendError(res, scanned.code ?? API_ERROR_CODES.INVALID_ENTRY, scanned.message, scanned.details)
  return sendJson(res, 200, { ok: true, plan: scanned.plan })
}

export async function libraryImport(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const imported = await importLibrary({ root: authorized.root, sourcePath: request.sourcePath })
  if (!imported.ok) return sendError(res, imported.code ?? API_ERROR_CODES.INVALID_ENTRY, imported.message, imported.details)
  return sendJson(res, 200, { ok: true, report: imported.report })
}

export async function libraryPrimary(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const set = await setPrimaryCarrier({ root: authorized.root, primaryCarrier: request.primaryCarrier, expectedRevision: request.expectedRevision })
  if (!set.ok) return sendError(res, set.code ?? API_ERROR_CODES.INVALID_ENTRY, set.message, set.details)
  return sendJson(res, 200, { ok: true, document: set.document, ...(set.enabled ? { enabled: set.enabled } : {}) })
}

/** library 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  libraries,
  libraryDiagnose,
  libraryCreate,
  libraryScan,
  libraryImport,
  libraryPrimary
}
