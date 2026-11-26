/**
 * plugins 域 handler（OS-141 daemon 拆分）——8 端点，与 contracts/plugins.mjs 一一对应：
 * stylesGet/skillsGet/skillGet/genresGet（风格·技能·体裁货架）、pluginsGet（统一清单只读聚合）、
 * suitesGet/suiteSettingsPut/suiteStatePut（五类货架的统一治理）。
 *
 * 统一签名 `async handler(ctx)`：全部端点只读货架／写套件状态，不碰库文件。
 * OS-192：legacy page 模式的 suiteStateDataGet/Put 已退役。
 */
import { API_ERROR_CODES } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot } from '../../host/authorize.mjs'
import { skillSummary, skillsForGenre } from '../../services/skills.mjs'
import { effectiveSkillsDirs } from '../../services/systemPrompt.mjs'
import { shelfDomainData } from '../../protocol/shelfManifests.mjs'
import { listAllPlugins } from '../../protocol/plugins.mjs'
import {
  MODULE_MANIFESTS,
  MODULE_MANIFEST_WARNINGS, MODULE_MANIFEST_NOTICES, MODULE_SOURCE_GROUPS,
  moduleRole, moduleSource, slotProjection
} from '../../protocol/modules.mjs'
import { BUILTIN_PAGE_IDS } from '../../protocol/naming.mjs'
import { capabilityStartupReport, moduleStatusProjection, projectModuleGraph } from '../../protocol/capabilityGraph.mjs'
import {
  moduleRootsReport, sourcesFor, rebuildRuntime, graphInputsFor
} from '../../host/moduleRuntime.mjs'
import { previewRoot, addRoot, removeRoot, moduleRootsPath } from '../../host/moduleRoots.mjs'
import {
  listSuitesPublic,
  saveSuiteSettings,
  setSuiteEnabled
} from '../../services/suites.mjs'

/** 五类货架的统一装载参数（一个入口取数：suites/skills/styles/genres/runtimes）。 */
function shelfOpts(context, root = '') {
  return {
    suitesDirs: context.suitesDirs ?? [],
    skillsDirs: context.skillsDirs ?? [],
    stylesDirs: context.stylesDirs ?? [],
    genresDirs: context.genresDirs ?? [],
    runtimesDirs: context.runtimesDirs ?? [],
    suiteStatePath: context.suiteStatePath ?? '',
    root
  }
}

/** OS-192：四个货架读取端点保留 id/路径/响应形状，内部统一从 shelfManifests 取数。 */
export async function stylesGet(ctx) {
  const { res, context } = ctx
  const { items, warnings } = shelfDomainData({ stylesDirs: context.stylesDirs }, 'style')
  // OS-109：带上真实目录——前端「本机路径」要显示绝对路径并能一键打开
  return sendJson(res, 200, { ok: true, styles: items, warnings, dirs: (context.stylesDirs || []).filter(Boolean) })
}

export async function skillsGet(ctx) {
  const { res, request, context } = ctx
  const { items, warnings } = shelfDomainData({ skillsDirs: effectiveSkillsDirs(context) }, 'skill')
  const filtered = request.genre ? skillsForGenre(items, request.genre) : items
  return sendJson(res, 200, {
    ok: true,
    skills: filtered.map(skillSummary),
    warnings
  })
}

export async function skillGet(ctx) {
  const { res, request, context } = ctx
  const { items } = shelfDomainData({ skillsDirs: effectiveSkillsDirs(context) }, 'skill')
  const skill = items.find((item) => item.name === request.name)
  if (!skill) return sendError(res, API_ERROR_CODES.NOT_FOUND, `货架上没有这个技能：${request.name}`)
  return sendJson(res, 200, {
    ok: true,
    skill: { ...skillSummary(skill), body: skill.body, tools: skill.tools, output: skill.output, domain: skill.domain }
  })
}

export async function genresGet(ctx) {
  const { res, context } = ctx
  const { items, warnings } = shelfDomainData({ genresDirs: context.genresDirs }, 'genre')
  return sendJson(res, 200, { ok: true, genres: items, warnings })
}

/** OS-197：迁移失败点名到本机模块；报告与快照用同一份 excluded。 */
function annotateLocalModules(localModules, migrations) {
  const failed = new Map((migrations.failures ?? []).map((item) => [item.plugin, item]))
  return localModules.map((item) => {
    const failure = failed.get(item.id)
    return failure
      ? { ...item, status: 'invalid', gate: 'migration', reason: failure.message }
      : item
  })
}

function migrationReport(state, snapshot) {
  const dataAhead = (state.dataVersions ?? []).flatMap((data) => {
    const route = snapshot.routes?.[data.capability]
    if (!route || route.version >= data.to) return []
    return [{
      capability: data.capability,
      dataVersion: data.to,
      provider: route.provider,
      providerVersion: route.version,
      journalPath: data.journalPath,
      message: `库数据已是 ${data.capability}@${data.to}，旧供给者 ${route.provider}@${route.version} 会误读`
    }]
  })
  return {
    ok: state.ok,
    ran: state.ran.map((item) => ({ module: item.plugin, capability: item.capability, from: item.from, to: item.to, journalPath: item.journalPath, backupPath: item.backupPath, restored: item.restored })),
    skipped: state.skipped.map((item) => ({ module: item.plugin, capability: item.capability, from: item.from, to: item.to, journalPath: item.journalPath })),
    failures: state.failures.map((item) => ({
      module: item.plugin ?? item.disable?.[0] ?? '',
      capability: item.capability,
      from: item.from,
      to: item.to,
      reason: item.reason,
      message: item.message,
      journalPath: item.journalPath,
      backupPath: item.backupPath,
      rolledBack: item.rolledBack,
      restored: item.restored
    })),
    excluded: state.excluded,
    dataVersions: state.dataVersions,
    dataAhead
  }
}

export async function pluginsGet(ctx) {
  const { res, request, context, allowlist } = ctx
  // OS-160：root 可选——带库（开着库）才授权并写库内；不带＝设置页全局入口，回落机器级缺省。
  const auth = text(request.root).trim() ? authorizeRoot(allowlist, request.root) : { ok: true, root: '' }
  if (!auth.ok) return sendError(res, auth.code, auth.message, auth.details)
  // OS-120：三套 spec 的统一视图（只读聚合）。一套读崩不拖垮其余两套——聚合层内部已隔离。
  const listed = await listAllPlugins({
    suitesDirs: context.suitesDirs,
    suiteStatePath: context.suiteStatePath,
    root: auth.root,
    skillsDirs: context.skillsDirs,
    stylesDirs: context.stylesDirs,
    genresDirs: context.genresDirs,
    runtimesDirs: context.runtimesDirs
  })
  // OS-200：清单、按库启停、套件状态、快照与停用预检从同一份输入推导（与 uiStatePut 的闸同源）。
  const inputs = await graphInputsFor(auth.root, context.env)
  const { manifests, snapshot, state, suiteState, base } = inputs
  const sources = new Map((await sourcesFor(context.env)).map((source) => [source.id, source]))
  const report = await moduleRootsReport(context.env)
  const migrations = inputs.migrations ?? {
    ok: true, ran: [], skipped: [], failures: [], excluded: [], migrations: [], dataVersions: [], fresh: false
  }
  const sourceOf = (id) => sources.get(id) ?? moduleSource(id) ?? {}
  const projected = projectModuleGraph({ snapshot, manifests, state, suiteState, base })
  // OS-198：当前库的 slot 投影——页签/右栏/设置区/宿主动作只照这份数据渲染。
  const orderHints = new Map()
  for (const manifest of MODULE_MANIFESTS) {
    for (const placement of manifest.slots ?? []) {
      if (Number.isInteger(placement.order)) orderHints.set(`${placement.slot}:${placement.page}`, placement.order)
    }
  }
  const statuses = new Map(moduleStatusProjection(snapshot).map((item) => [item.id, item]))
  const localIds = new Set(report.localModules.filter((item) => item.status === 'loaded').map((item) => item.id))
  const projection = slotProjection(manifests, snapshot.enabled ?? {}, {
    builtinPages: new Set(BUILTIN_PAGE_IDS),
    localIds,
    orderHints,
    statuses
  })
  // OS-200：套件货架并入同一响应（与 GET /api/suites 同一份记录，端点原样保留）。
  const suites = await listSuitesPublic(shelfOpts(context, auth.root))
  const suitesUserDir = Array.isArray(context.suitesDirs) && context.suitesDirs[1] ? context.suitesDirs[1] : ''
  return sendJson(res, 200, {
    ok: true,
    plugins: listed.plugins,
    byKind: listed.byKind,
    byGroup: listed.byGroup,
    overrides: listed.overrides,
    stats: listed.stats,
    // OS-145：模块插件自报设置（设置页「模块」组的数据底；启停状态由前端按库内 ui-state 判定）
    // OS-146：settingsHint/settingsJump ＝真配置在别处时的指路（设置页只指路，不摆第二份输入框）
    modules: manifests.map((manifest) => ({
      spec: manifest.spec,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      class: manifest.class,
      role: moduleRole(manifest),
      builtin: manifest.builtin,
      source: sourceOf(manifest.id).source ?? '',
      sourceDir: sourceOf(manifest.id).sourceDir ?? '',
      manifestSha256: sourceOf(manifest.id).manifestSha256 ?? '',
      contentSha256: sourceOf(manifest.id).contentSha256 ?? '',
      contentChanged: Boolean(sourceOf(manifest.id).contentChanged),
      description: manifest.description,
      endpoints: manifest.endpoints,
      pages: manifest.pages,
      slots: manifest.slots,
      settings: manifest.settings,
      settingsHint: manifest.settingsHint,
      settingsJump: manifest.settingsJump,
      ...projected.projections.get(manifest.id)
    })),
    moduleManifestWarnings: MODULE_MANIFEST_WARNINGS,
    moduleManifestNotices: MODULE_MANIFEST_NOTICES,
    moduleSourceGroups: MODULE_SOURCE_GROUPS,
    // OS-200：顶层能力图（节点就是 modules[] 本身，边按依赖声明逐条展开）。
    moduleGraph: projected.moduleGraph,
    capabilityReport: capabilityStartupReport(snapshot),
    // OS-200：套件货架并入同一响应（suites 与 GET /api/suites 逐条同源）。
    suites: suites.suites,
    suiteOverrides: suites.overrides,
    suiteUserDir: suitesUserDir,
    suiteWarnings: suites.warnings,
    // OS-197：能力迁移的执行／失败／已迁数据与回退保护（真实链路报告）。
    moduleMigrations: migrationReport(migrations, snapshot),
    // OS-196 G1/G2/G5：本机层报告（含每个模块的摘要、状态与失败门原因）。
    moduleRoots: report.roots,
    localModules: annotateLocalModules(report.localModules, migrations),
    moduleSlotPlacements: report.slotPlacements,
    slots: projection.slots,
    slotWarnings: projection.warnings,
    moduleRootWarnings: report.warnings,
    ...(report.blocked ? { moduleRootBlocked: report.blocked } : {}),
    ...(listed.warnings.length ? { warnings: listed.warnings } : {})
  })
}

/** 五个本机模块根端点共用的视图：读报告，不触发重建。 */
async function rootsView(ctx) {
  const report = await moduleRootsReport(ctx.context.env)
  const modules = Object.fromEntries(report.localModules.map((item) => [item.id, item]))
  return {
    ok: true,
    path: moduleRootsPath(ctx.context.env),
    roots: report.roots.map((root) => ({
      ...root,
      modules: root.modules.map((item) => modules[item.id] ?? item)
    })),
    localModules: report.localModules,
    slotPlacements: report.slotPlacements,
    warnings: report.warnings,
    ...(report.blocked ? { blocked: report.blocked } : {})
  }
}

export async function moduleRootsGet(ctx) {
  return sendJson(ctx.res, 200, await rootsView(ctx))
}

export async function moduleRootsPreview(ctx) {
  const { res, request, context } = ctx
  const preview = previewRoot(request.path, context.env)
  if (!preview.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, preview.warnings.map((item) => item.message).join('；'))
  return sendJson(res, 200, preview)
}

export async function moduleRootsAdd(ctx) {
  const { res, request, context } = ctx
  if (request.confirm !== true) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '必须先预览清单并显式确认，才能登记模块根')
  }
  const added = await addRoot(request.path, context.env)
  if (!added.ok) return sendError(res, added.code ?? API_ERROR_CODES.INVALID_ENTRY, added.message)
  await rebuildRuntime(context.env)
  return sendJson(res, 200, await rootsView(ctx))
}

export async function moduleRootsRemove(ctx) {
  const { res, request, context } = ctx
  const removed = await removeRoot(request.path, context.env)
  if (!removed.ok) return sendError(res, removed.code ?? API_ERROR_CODES.INVALID_ENTRY, removed.message)
  await rebuildRuntime(context.env)
  return sendJson(res, 200, await rootsView(ctx))
}

export async function moduleRootsRefresh(ctx) {
  const { res, context } = ctx
  const rebuilt = await rebuildRuntime(context.env)
  if (!rebuilt.ok) return sendJson(res, 200, { ...(await rootsView(ctx)), blocked: { gate: rebuilt.gate, reason: rebuilt.reason } })
  return sendJson(res, 200, { ...(await rootsView(ctx)), id: rebuilt.id })
}

export async function suitesGet(ctx) {
  const { res, request, context, allowlist } = ctx
  // OS-160：root 可选——带库（开着库）才授权并写库内；不带＝设置页全局入口，回落机器级缺省。
  const auth = text(request.root).trim() ? authorizeRoot(allowlist, request.root) : { ok: true, root: '' }
  if (!auth.ok) return sendError(res, auth.code, auth.message, auth.details)
  const listed = await listSuitesPublic(shelfOpts(context, auth.root))
  const suitesUserDir = Array.isArray(context.suitesDirs) && context.suitesDirs[1] ? context.suitesDirs[1] : ''
  return sendJson(res, 200, {
    ok: true,
    suites: listed.suites,
    overrides: listed.overrides,
    ...(suitesUserDir ? { userDir: suitesUserDir } : {}),
    ...(listed.warnings?.length ? { warnings: listed.warnings } : {})
  })
}

export async function suiteSettingsPut(ctx) {
  const { res, request, context, allowlist } = ctx
  // OS-160：root 可选——带库（开着库）才授权并写库内；不带＝设置页全局入口，回落机器级缺省。
  const auth = text(request.root).trim() ? authorizeRoot(allowlist, request.root) : { ok: true, root: '' }
  if (!auth.ok) return sendError(res, auth.code, auth.message, auth.details)
  const saved = await saveSuiteSettings(shelfOpts(context, auth.root), '', request.id, request.values, '')
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.INVALID_ENTRY, saved.message)
  return sendJson(res, 200, { ok: true, values: saved.values })
}

export async function suiteStatePut(ctx) {
  const { res, request, context, allowlist } = ctx
  // OS-160：root 可选——带库（开着库）才授权并写库内；不带＝设置页全局入口，回落机器级缺省。
  const auth = text(request.root).trim() ? authorizeRoot(allowlist, request.root) : { ok: true, root: '' }
  if (!auth.ok) return sendError(res, auth.code, auth.message, auth.details)
  const set = await setSuiteEnabled(shelfOpts(context, auth.root), '', request.id, request.enabled, '')
  if (!set.ok) return sendError(res, set.code ?? API_ERROR_CODES.INVALID_ENTRY, set.message)
  return sendJson(res, 200, { ok: true, enabled: set.enabled })
}

/** plugins 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  stylesGet,
  skillsGet,
  skillGet,
  genresGet,
  pluginsGet,
  moduleRootsGet,
  moduleRootsPreview,
  moduleRootsAdd,
  moduleRootsRemove,
  moduleRootsRefresh,
  suitesGet,
  suiteSettingsPut,
  suiteStatePut
}
