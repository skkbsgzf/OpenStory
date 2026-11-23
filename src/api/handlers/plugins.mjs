/**
 * plugins 域 handler（OS-141 daemon 拆分）——10 端点，与 contracts/plugins.mjs 一一对应：
 * stylesGet/skillsGet/skillGet/genresGet（风格·技能·体裁货架）、pluginsGet（三套 spec 只读聚合）、
 * suitesGet/suiteSettingsPut/suiteStatePut/suiteStateDataGet/suiteStateDataPut（套件货架与设置）。
 *
 * 统一签名 `async handler(ctx)`：全部端点只读货架／写套件状态，不碰库文件，不做 root 校验
 * （与拆分前一致）。
 */
import { API_ERROR_CODES } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { loadStylePacks } from '../../services/stylePacks.mjs'
import { loadSkills, skillSummary, skillsForGenre } from '../../services/skills.mjs'
import { effectiveSkillsDirs } from '../../services/systemPrompt.mjs'
import { loadGenres } from '../../services/genres.mjs'
import { listAllPlugins } from '../../protocol/plugins.mjs'
import { MODULE_MANIFESTS } from '../../protocol/modules.mjs'
import {
  listSuitesPublic,
  saveSuiteSettings,
  saveSuiteStateData,
  setSuiteEnabled,
  getSuiteStateData
} from '../../services/suites.mjs'

export async function stylesGet(ctx) {
  const { res, context } = ctx
  const packs = await loadStylePacks(context.stylesDirs)
  // OS-109：带上真实目录——前端「本机路径」要显示绝对路径并能一键打开
  return sendJson(res, 200, { ok: true, styles: packs.styles, warnings: packs.warnings, dirs: (context.stylesDirs || []).filter(Boolean) })
}

export async function skillsGet(ctx) {
  const { res, request, context } = ctx
  const loaded = loadSkills(effectiveSkillsDirs(context))
  const filtered = request.genre ? skillsForGenre(loaded.skills, request.genre) : loaded.skills
  return sendJson(res, 200, {
    ok: true,
    skills: filtered.map(skillSummary),
    warnings: loaded.warnings
  })
}

export async function skillGet(ctx) {
  const { res, request, context } = ctx
  const loaded = loadSkills(effectiveSkillsDirs(context))
  const skill = loaded.skills.find((item) => item.name === request.name)
  if (!skill) return sendError(res, API_ERROR_CODES.NOT_FOUND, `货架上没有这个技能：${request.name}`)
  return sendJson(res, 200, {
    ok: true,
    skill: { ...skillSummary(skill), body: skill.body, tools: skill.tools, output: skill.output, domain: skill.domain }
  })
}

export async function genresGet(ctx) {
  const { res, context } = ctx
  const loaded = loadGenres(context.genresDirs)
  return sendJson(res, 200, { ok: true, genres: loaded.genres, warnings: loaded.warnings })
}

export async function pluginsGet(ctx) {
  const { res, context } = ctx
  // OS-120：三套 spec 的统一视图（只读聚合）。一套读崩不拖垮其余两套——聚合层内部已隔离。
  const listed = await listAllPlugins({
    suitesDirs: context.suitesDirs,
    suiteStatePath: context.suiteStatePath,
    skillsDirs: context.skillsDirs,
    runtimesDirs: context.runtimesDirs
  })
  return sendJson(res, 200, {
    ok: true,
    plugins: listed.plugins,
    byKind: listed.byKind,
    stats: listed.stats,
    // OS-145：模块插件自报设置（设置页「模块」组的数据底；启停状态由前端按库内 ui-state 判定）
    modules: MODULE_MANIFESTS.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      pages: manifest.pages,
      settings: manifest.settings
    })),
    ...(listed.warnings.length ? { warnings: listed.warnings } : {})
  })
}

export async function suitesGet(ctx) {
  const { res, context } = ctx
  const listed = await listSuitesPublic(context.suitesDirs, context.suiteStatePath)
  const suitesUserDir = Array.isArray(context.suitesDirs) && context.suitesDirs[1] ? context.suitesDirs[1] : ''
  return sendJson(res, 200, { ok: true, suites: listed.suites, ...(suitesUserDir ? { userDir: suitesUserDir } : {}), ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) })
}

export async function suiteSettingsPut(ctx) {
  const { res, request, context } = ctx
  const saved = await saveSuiteSettings(context.suitesDirs, context.suiteStatePath, request.id, request.values)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.INVALID_ENTRY, saved.message)
  return sendJson(res, 200, { ok: true, values: saved.values })
}

export async function suiteStatePut(ctx) {
  const { res, request, context } = ctx
  const set = await setSuiteEnabled(context.suitesDirs, context.suiteStatePath, request.id, request.enabled)
  if (!set.ok) return sendError(res, set.code ?? API_ERROR_CODES.INVALID_ENTRY, set.message)
  return sendJson(res, 200, { ok: true, enabled: set.enabled })
}

export async function suiteStateDataGet(ctx) {
  const { res, request, context } = ctx
  const loaded = await getSuiteStateData(context.suitesDirs, context.suiteStatePath, request.id)
  if (!loaded.ok) return sendError(res, loaded.code ?? API_ERROR_CODES.INVALID_ENTRY, loaded.message)
  return sendJson(res, 200, { ok: true, id: loaded.id, values: loaded.values })
}

export async function suiteStateDataPut(ctx) {
  const { res, request, context } = ctx
  const saved = await saveSuiteStateData(context.suitesDirs, context.suiteStatePath, request.id, request.values)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.INVALID_ENTRY, saved.message)
  return sendJson(res, 200, { ok: true, values: saved.values })
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
  suiteStatePut,
  suiteStateDataGet,
  suiteStateDataPut
}
