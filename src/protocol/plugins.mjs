/**
 * 插件统一清单（OS-120 → OS-192 升格）。
 *
 * 五类货架都经 protocol/shelfManifests.mjs 投影成 module@2 套件，本模块只做只读聚合：
 * 不维护自己的加载器、不造第二份真源。一份清单回答「我装了什么 / 分几类 / 谁被拦下」。
 *
 * kind 是历史三分类（suite/skill/runtime），保留给既有调用方；
 * shelfKind/group 才是 OS-192 的五类一等身份与设置页六组。
 */
import { loadShelfFacts, SHELF_GROUPS } from './shelfManifests.mjs'
import { readShelfSuiteState } from './shelfManifests.mjs'
import { resolveSuiteDependencies } from './dependencyGraph.mjs'

const text = (value) => String(value ?? '')

/** 历史三分类（展示顺序：套件在最前，它是用户心智里的「插件」）。 */
export const PLUGIN_KINDS = Object.freeze(['suite', 'skill', 'runtime'])

/** 种类的人话名（设置页直接显示，不再做映射）。 */
export const KIND_LABELS = Object.freeze({
  suite: '套件',
  skill: '技能',
  runtime: 'Agent 运行时'
})

export { SHELF_GROUPS }

/** 五类货架 → 历史三分类（对外形状不变）。 */
function legacyKind(shelfKind) {
  if (shelfKind === 'skill') return 'skill'
  if (shelfKind === 'runtime') return 'runtime'
  return 'suite'
}

function entry(record, suiteState, blocked, missing) {
  const stateEntry = suiteState?.suites?.[record.id] ?? {}
  const src = record.sourceDetail ?? {}
  return {
    kind: legacyKind(record.kind),
    kindLabel: KIND_LABELS[legacyKind(record.kind)],
    shelfKind: record.kind,
    group: record.group,
    id: text(record.id),
    name: text(record.name) || text(record.id),
    version: text(record.version),
    description: text(record.description),
    enabled: stateEntry.enabled !== false,
    source: text(record.source),
    sourceDetail: {
      kind: src.kind || text(record.source),
      dir: src.dir || text(record.dir),
      entry: '',
      shadowed: record.shadowed === true,
      loadedFrom: src.loadedFrom || text(record.source)
    },
    ...(record.kind === 'runtime' ? { fixture: record.fixture === true } : {}),
    blocked: Boolean(blocked),
    blockedReason: text(blocked?.reason),
    missingDependencies: Array.isArray(missing) ? missing.map(text) : []
  }
}

/**
 * 聚合五类货架。
 * @returns {Promise<{ok:true, plugins:object[], byKind:object, byGroup:object, overrides:object[], warnings:object[], stats:object}>}
 */
export async function listAllPlugins({
  suitesDirs = [], suiteStatePath = '', skillsDirs = [], stylesDirs = [], genresDirs = [],
  runtimesDirs = [], root = ''
} = {}) {
  const facts = loadShelfFacts({
    suitesDirs, skillsDirs, stylesDirs, genresDirs, runtimesDirs
  })
  const suiteState = readShelfSuiteState({ root, machinePath: suiteStatePath })
  const enabledOf = (record) => suiteState?.suites?.[record.id]?.enabled !== false
  const graph = resolveSuiteDependencies(
    facts.records.map((record) => ({ id: record.id, enabled: enabledOf(record), requires: record.requires }))
  )
  const unmetById = new Map(graph.unmet.map((item) => [item.id, item.needs]))
  const cycleById = new Map(graph.cycles.flat().map((id) => [id, graph.cycles.find((cycle) => cycle.includes(id))]))
  const blockedOf = (record) => {
    const missing = unmetById.get(record.id)
    const cycle = cycleById.get(record.id)
    if (!missing?.length && !cycle) return null
    return {
      reason: cycle ? `依赖成环：${cycle.join(' → ')}` : `缺依赖：${missing.join('、')}`,
      cycle,
      missing
    }
  }
  const plugins = facts.records.map((record) => {
    const blocked = blockedOf(record)
    return entry(record, suiteState, blocked, blocked?.missing ?? [])
  })
  const byKind = Object.fromEntries(PLUGIN_KINDS.map((kind) => [kind, plugins.filter((item) => item.kind === kind)]))
  const byGroup = Object.fromEntries(SHELF_GROUPS.map((group) => [group, plugins.filter((item) => item.group === group)]))
  return {
    ok: true,
    plugins,
    byKind,
    byGroup,
    overrides: facts.overrides,
    warnings: [...facts.warnings],
    stats: {
      total: plugins.length,
      enabled: plugins.filter((item) => item.enabled).length,
      blocked: plugins.filter((item) => item.blocked).length,
      byKind: Object.fromEntries(PLUGIN_KINDS.map((kind) => [kind, byKind[kind].length])),
      byGroup: Object.fromEntries(SHELF_GROUPS.map((group) => [group, byGroup[group].length]))
    }
  }
}

/** 单条插件的详情（设置页点进去用）；找不到返回 null。 */
export async function pluginDetail(opts, kind, id) {
  const listed = await listAllPlugins(opts)
  const wantedKind = text(kind).trim()
  const wantedId = text(id).trim()
  if (!PLUGIN_KINDS.includes(wantedKind) && !SHELF_GROUPS.includes(wantedKind)) return null
  return listed.plugins.find((item) => item.id === wantedId
    && (item.kind === wantedKind || item.shelfKind === wantedKind || item.group === wantedKind)) ?? null
}

/** 只看被拦下的插件（缺依赖 / 成环）。 */
export async function listBlockedPlugins(opts = {}) {
  const listed = await listAllPlugins(opts)
  return { ok: true, plugins: listed.plugins.filter((item) => item.blocked), warnings: listed.warnings }
}

/**
 * OS-192：legacy page 模式已退役——套件不再有自带设置页资产路径。
 * 保留这个纯函数只为老调用方拿到空串（退役守卫见 test/plugins.test.mjs）。
 */
export function suiteAssetPath() {
  return ''
}

/** 健康检查：给设置页一个「有没有东西坏了」的总览。 */
export async function pluginHealth(opts = {}) {
  const listed = await listAllPlugins(opts)
  const blocked = listed.plugins.filter((item) => item.blocked)
  return {
    ok: true,
    healthy: blocked.length === 0 && listed.warnings.length === 0,
    stats: listed.stats,
    blocked,
    warnings: listed.warnings,
    topWarnings: listed.warnings.slice(0, 3)
  }
}
