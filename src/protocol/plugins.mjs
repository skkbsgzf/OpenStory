/**
 * 插件统一清单（OS-120）。
 *
 * 作者口径：「在插件治理上，dsh 或者 Obsidian 有没有什么可以借鉴的」——
 * 可借鉴的第三条是「一份声明」（DSH 的 patch 就是全部），而本仓现在是
 * suites / skills / runtimes 三套 spec 各管一摊，用户永远回答不了「我装了什么」。
 *
 * 本模块只做**只读聚合**：不改三套加载器的落盘格式、不改它们的校验口径，
 * 只是把三份清单投影成同一个形状，给设置页和 MCP 用。
 *
 * 一条纪律：这里的 kind 是展示用的分类，不是真源——真源永远是三套 spec 自己。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listSuitesPublic } from '../services/suites.mjs'
import { loadSkills } from '../services/skills.mjs'
import { loadRuntimeKits } from '../services/runtimes.mjs'

const text = (value) => String(value ?? '')

/** 三套插件种类（展示顺序：套件在最前，它是用户心智里的「插件」）。 */
export const PLUGIN_KINDS = Object.freeze(['suite', 'skill', 'runtime'])

/** 种类的人话名（设置页直接显示，不再做映射）。 */
export const KIND_LABELS = Object.freeze({
  suite: '套件',
  skill: '技能',
  runtime: 'Agent 运行时'
})

/** 统一条目形状。三套 spec 的差异在这里被抹平，上层不再关心它原本属于哪一套。 */
function entry(kind, raw) {
  return {
    kind,
    kindLabel: KIND_LABELS[kind],
    id: text(raw.id),
    name: text(raw.name) || text(raw.id),
    version: text(raw.version),
    description: text(raw.description),
    enabled: raw.enabled !== false,
    source: text(raw.source),
    // sourceDetail 逐套件不同（只有 suite 有物理目录），缺了就是空对象——
    // 上层按 kind 判断要不要用，不要假设它一定完整
    sourceDetail: raw.sourceDetail && typeof raw.sourceDetail === 'object' ? raw.sourceDetail : {},
    // OS-150a：运行时套件的夹具标记要照实透传（聚合层丢了它，设置页总览就会把
    // echo-kit 这类测试夹具当产品套件摆出来）。其它种类的条目没有这个概念，不加字段。
    ...(kind === 'runtime' ? { fixture: raw.fixture === true } : {}),
    // 这三项是可选的：workbuddy 那半（版本闸/依赖闸）落地后才会出现
    blocked: raw.blocked === true,
    blockedReason: text(raw.blockedReason),
    missingDependencies: Array.isArray(raw.missingDependencies) ? raw.missingDependencies.map(text) : []
  }
}

/**
 * 聚合三套清单。
 *
 * @param {object} opts
 * @param {string[]} [opts.suitesDirs]  套件目录（与 listSuitesPublic 同参）
 * @param {string} [opts.suiteStatePath] 套件启停状态文件
 * @param {Array<string|{dir:string,source:string}>} [opts.skillsDirs]
 * @param {string[]} [opts.runtimesDirs]
 * @returns {Promise<{ok:true, plugins:object[], byKind:object, warnings:object[], stats:object}>}
 */
export async function listAllPlugins({ suitesDirs = [], suiteStatePath = '', skillsDirs = [], runtimesDirs = [] } = {}) {
  const warnings = []
  const plugins = []

  // 套件：listSuitesPublic 内部已经做了 state 合并（enabled/values），直接复用
  try {
    const shelf = await listSuitesPublic(suitesDirs, suiteStatePath)
    for (const suite of shelf.suites || []) plugins.push(entry('suite', suite))
    for (const warning of shelf.warnings || []) warnings.push({ kind: 'suite', ...warning })
  } catch (error) {
    // 一套读崩不许拖垮其余两套——这是聚合层最该守的一条
    warnings.push({ kind: 'suite', code: 'SUITES_UNREADABLE', message: `套件清单读不了：${text(error?.message || error)}` })
  }

  // 技能：loadSkills 是纯同步扫描，没有外部状态文件（技能没有启停概念）
  try {
    const loaded = loadSkills(skillsDirs)
    for (const skill of loaded.skills || []) {
      plugins.push(entry('skill', { ...skill, enabled: true }))
    }
    for (const warning of loaded.warnings || []) warnings.push({ kind: 'skill', ...warning })
  } catch (error) {
    warnings.push({ kind: 'skill', code: 'SKILLS_UNREADABLE', message: `技能清单读不了：${text(error?.message || error)}` })
  }

  // 运行时：loadRuntimeKits 同样是同步扫描
  try {
    const loaded = loadRuntimeKits(runtimesDirs)
    for (const kit of loaded.kits || []) {
      plugins.push(entry('runtime', { ...kit, enabled: true }))
    }
    for (const warning of loaded.warnings || []) warnings.push({ kind: 'runtime', ...warning })
  } catch (error) {
    warnings.push({ kind: 'runtime', code: 'RUNTIMES_UNREADABLE', message: `运行时清单读不了：${text(error?.message || error)}` })
  }

  const byKind = Object.fromEntries(PLUGIN_KINDS.map((kind) => [kind, plugins.filter((item) => item.kind === kind)]))
  return {
    ok: true,
    plugins,
    byKind,
    warnings,
    stats: {
      total: plugins.length,
      enabled: plugins.filter((item) => item.enabled).length,
      blocked: plugins.filter((item) => item.blocked).length,
      byKind: Object.fromEntries(PLUGIN_KINDS.map((kind) => [kind, byKind[kind].length]))
    }
  }
}

/**
 * 单条插件的详情（设置页点进去用）。
 * 找不到返回 null——上层据此显示「这条已经被删掉了」，而不是抛错。
 */
export async function pluginDetail(opts, kind, id) {
  const listed = await listAllPlugins(opts)
  const wantedKind = text(kind).trim()
  const wantedId = text(id).trim()
  if (!PLUGIN_KINDS.includes(wantedKind) || !wantedId) return null
  return listed.plugins.find((item) => item.kind === wantedKind && item.id === wantedId) ?? null
}

/**
 * 只看被拦下的插件（版本不够 / 依赖缺失）。
 * 存在的意义：作者排查「为什么这个套件没生效」时，不用自己在 400 条里找。
 */
export async function listBlockedPlugins(opts = {}) {
  const listed = await listAllPlugins(opts)
  return { ok: true, plugins: listed.plugins.filter((item) => item.blocked), warnings: listed.warnings }
}

/** 套件自带页面/设置页的物理路径（设置页要跳过去或同源装载时用）。 */
export function suiteAssetPath(plugin, which = 'settings') {
  if (!plugin || plugin.kind !== 'suite') return ''
  const detail = plugin.sourceDetail || {}
  const dir = text(detail.dir)
  if (!dir) return ''
  if (which === 'settings') return text(detail.entry)
  if (which === 'dir') return dir
  return ''
}

/**
 * 健康检查：给设置页一个「有没有东西坏了」的总览。
 * 只报计数与最严重的三条 warning，不做修复建议（修复永远是人来定）。
 */
export async function pluginHealth(opts = {}) {
  const listed = await listAllPlugins(opts)
  const blocked = listed.plugins.filter((item) => item.blocked)
  const warnings = listed.warnings
  return {
    ok: true,
    healthy: blocked.length === 0 && warnings.length === 0,
    stats: listed.stats,
    blocked,
    warnings,
    topWarnings: warnings.slice(0, 3)
  }
}
