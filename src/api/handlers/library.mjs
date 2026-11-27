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
import { migrationBackupsFor, upgradePlanFor, migrationStatusFor, manifestsFor, sourcesFor } from '../../host/moduleRuntime.mjs'
import { applyUpgradePlan, rememberUpgradePlan } from '../../host/libraryMigrations.mjs'
import { diagnoseLibraryUpgrade } from '../../protocol/libraryUpgrade.mjs'

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

/* ================================================================
 * OS-221：迁移状态与备份的专用只读端点
 *
 * 两个 handler 的共同纪律：root 授权照常走 authorizeRoot；取数只经
 * `migrationStatusFor` / `migrationBackupsFor`（纯读，不跑迁移、不写 journal/备份）。
 * 除越权 root 与非法 backup 路径外，任何「不健康」都放进响应体的类型化 issues，
 * 不升级成 HTTP 错误——状态查询本身必须成功可读。
 * ================================================================ */

/** `backup` 查询串只接受库内相对路径（.history/…）；不合法即拒，绝不做磁盘任意读。 */
function requestedBackupRelative(value) {
  const raw = text(value).trim()
  if (!raw) return { ok: true, relative: '' }
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
  const parts = normalized.split('/')
  const bad = normalized.startsWith('/')
    || /^[a-zA-Z]:\//u.test(normalized)
    || parts.some((part) => !part || part === '.' || part === '..')
    || parts[0] !== '.history'
  if (bad) return { ok: false, relative: normalized }
  return { ok: true, relative: normalized }
}

export async function libraryMigrationStatusGet(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const status = await migrationStatusFor(authorized.root, context.env)
  if (!status) return sendError(res, API_ERROR_CODES.NO_LIBRARY, '迁移状态需要一个已授权的库根')
  return sendJson(res, 200, { ok: true, ...status })
}

export async function libraryMigrationBackupsGet(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const wanted = requestedBackupRelative(request.backup)
  if (!wanted.ok) {
    return sendError(res, API_ERROR_CODES.MIGRATION_BACKUP_PATH_INVALID,
      `backup 只接受库内 .history/ 下的相对路径：${wanted.relative}`, { backup: wanted.relative })
  }
  const report = await migrationBackupsFor(authorized.root, context.env)
  if (!report) return sendError(res, API_ERROR_CODES.NO_LIBRARY, '备份校验需要一个已授权的库根')
  const posix = (value) => text(value).replaceAll('\\', '/')
  const backups = wanted.relative
    ? report.backups.filter((backup) => backup.path === wanted.relative)
    : report.backups
  const issues = wanted.relative
    ? report.issues.filter((issue) => posix(issue.path) === wanted.relative || posix(issue.path).startsWith(`${wanted.relative}/`))
    : report.issues
  const missing = Boolean(wanted.relative) && backups.length === 0
  if (missing) {
    issues.push({
      code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING,
      severity: 'error',
      scope: 'backup',
      path: wanted.relative,
      message: `没有这份备份目录：${wanted.relative}`
    })
  }
  return sendJson(res, 200, {
    ...report,
    // ok＝「这份查询本身成功」；备份是否完整只看 healthy 与 issues（不拿 ok 掩盖坏备份）。
    ok: true,
    healthy: report.healthy && !missing,
    backups,
    issues
  })
}

/* ================================================================
 * OS-222：diagnose→plan→confirm→apply→status/backup verify
 *
 * diagnose/plan/状态/备份校验是只读工具，可被 MCP 自动调用；apply 是显式动稿，
 * 只认 confirm:true + 已登记 planId，服务端复核 root/文件/迁移器摘要。
 * DATA_VERSION_AHEAD 只在计划/结果里如实呈现，apply 前由 plan 冲突判定拒绝。
 * ================================================================ */

/** OS-222：升级端点只接受契约声明字段；额外参数在 handler 前拒绝，零写入。 */
function rejectUnknownUpgradeFields(res, request, allowed) {
  const unknown = Object.keys(request ?? {}).filter((key) => !allowed.includes(key))
  if (!unknown.length) return true
  sendError(res, API_ERROR_CODES.INVALID_ENTRY, '升级请求包含未知参数', { fields: unknown })
  return false
}

export async function libraryUpgradeDiagnose(ctx) {
  const { res, request, context, allowlist } = ctx
  if (!rejectUnknownUpgradeFields(res, request, ['root'])) return null
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const section = await diagnoseLibraryUpgrade(authorized.root, { now: new Date() })
  return sendJson(res, 200, {
    ok: true, spec: 'openstory.upgrade-diagnose/v1', root: text(authorized.root), section, writes: false
  })
}

export async function libraryUpgradePlan(ctx) {
  const { res, request, context, allowlist } = ctx
  if (!rejectUnknownUpgradeFields(res, request, ['root'])) return null
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const plan = await upgradePlanFor(authorized.root, context.env)
  if (!plan) return sendError(res, API_ERROR_CODES.NO_LIBRARY, '升级计划需要一个已授权的库根')
  const planId = rememberUpgradePlan(plan)
  return sendJson(res, 200, { ok: true, plan, planId, writes: false })
}

export async function libraryUpgradeApply(ctx) {
  const { res, request, context, allowlist } = ctx
  if (!rejectUnknownUpgradeFields(res, request, ['root', 'planId', 'confirm', 'operationId'])) return null
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const [manifests, sources] = await Promise.all([
    manifestsFor(context.env), sourcesFor(context.env)
  ])
  const result = await applyUpgradePlan(authorized.root, {
    planId: request.planId, confirm: request.confirm, operationId: request.operationId,
    layer: { manifests, sources }
  }, context.env)
  if (!result.ok) {
    // 校验阶段零写入；执行失败已回滚/回滚未完成都带类型化 code 与可读 message。
    const code = result.code ?? (result.outcome === 'rollback-incomplete'
      ? API_ERROR_CODES.MIGRATION_FAILED : API_ERROR_CODES.LIBRARY_UPGRADE_FAILED)
    return sendError(res, code, result.message, {
      outcome: result.outcome, journals: result.journals, backups: result.backups,
      rolledBack: result.rolledBack, rollbackErrors: result.rollbackErrors, drift: result.drift
    })
  }
  return sendJson(res, 200, { ok: true, ...result })
}

/** library 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  libraries,
  libraryDiagnose,
  libraryCreate,
  libraryScan,
  libraryImport,
  libraryPrimary,
  libraryMigrationStatusGet,
  libraryMigrationBackupsGet,
  libraryUpgradeDiagnose,
  libraryUpgradePlan,
  libraryUpgradeApply
}
