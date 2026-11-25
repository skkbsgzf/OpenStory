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
  MODULE_MANIFESTS, MODULE_MANIFEST_WARNINGS, MODULE_MANIFEST_NOTICES, MODULE_SOURCE_GROUPS,
  CAPABILITY_STARTUP_REPORT, moduleRole, moduleSource
} from '../../protocol/modules.mjs'
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
  return sendJson(res, 200, {
    ok: true,
    plugins: listed.plugins,
    byKind: listed.byKind,
    byGroup: listed.byGroup,
    overrides: listed.overrides,
    stats: listed.stats,
    // OS-145：模块插件自报设置（设置页「模块」组的数据底；启停状态由前端按库内 ui-state 判定）
    // OS-146：settingsHint/settingsJump ＝真配置在别处时的指路（设置页只指路，不摆第二份输入框）
    modules: MODULE_MANIFESTS.map((manifest) => ({
      spec: manifest.spec,
      id: manifest.id,
      name: manifest.name,
      class: manifest.class,
      role: moduleRole(manifest),
      builtin: manifest.builtin,
      source: moduleSource(manifest.id)?.source ?? '',
      sourceDir: moduleSource(manifest.id)?.sourceDir ?? '',
      manifestSha256: moduleSource(manifest.id)?.manifestSha256 ?? '',
      description: manifest.description,
      endpoints: manifest.endpoints,
      pages: manifest.pages,
      slots: manifest.slots,
      settings: manifest.settings,
      settingsHint: manifest.settingsHint,
      settingsJump: manifest.settingsJump
    })),
    moduleManifestWarnings: MODULE_MANIFEST_WARNINGS,
    moduleManifestNotices: MODULE_MANIFEST_NOTICES,
    moduleSourceGroups: MODULE_SOURCE_GROUPS,
    capabilityReport: CAPABILITY_STARTUP_REPORT,
    ...(listed.warnings.length ? { warnings: listed.warnings } : {})
  })
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
  suitesGet,
  suiteSettingsPut,
  suiteStatePut
}
