/**
 * OS-192 · 五类货架的统一装载入口（一个入口、一套启停与状态、依赖闭包）。
 *
 * 单文件/单目录货架不另加 manifest：由各自的域适配器把现有事实投影成 module@2 套件形状，
 * 这里只做「投影 → 去重 → 报告覆盖」的纯编排。真源仍是 SKILL.md / styles/*.json /
 * genres/*.json / runtimes/<id>/manifest.json / suites/<id>/manifest.json。
 *
 * 依赖方向：protocol → services（与 plugins.mjs 同型）。模块内核不反向依赖服务之外的内容。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODULE_SPEC, validateModuleManifest } from './moduleManifest.mjs'
import { loadSuites, resolveSuiteStatePath } from '../services/suites.mjs'
import { loadSkills } from '../services/skills.mjs'
import { loadStylePacksSync } from '../services/stylePacks.mjs'
import { loadGenres } from '../services/genres.mjs'
import { loadRuntimeKits } from '../services/runtimes.mjs'

const text = (value) => String(value ?? '')

/**
 * OS-195b：底座货架的原始 runtime kit 清单——agent.runtime 内核经本底座契约取清单，
 * 不直引 services。只做只读转发，sidecar 生命周期与探活已归 agent.runtime 自己。
 */
export function loadRuntimeKitFacts(dirs = []) {
  return loadRuntimeKits(dirs)
}
/** frontmatter/JSON 里允许写 1 或 1.2；投影成 module@2 时补成三段，不丢弃货架条目。 */
function version3(value, fallback = '0.1.0') {
  const raw = text(value).trim()
  if (/^\d+$/u.test(raw)) return `${raw}.0.0`
  if (/^\d+\.\d+$/u.test(raw)) return `${raw}.0`
  return /^\d+\.\d+\.\d+$/u.test(raw) ? raw : fallback
}

/** 供给类型 → 设置页分组（工单点名的六组）。 */
export const SHELF_GROUPS = Object.freeze([
  '技能包', '文风包', '体裁包', '运行时套件', '业务套装', '推演规则包'
])

export const SHELF_KINDS = Object.freeze(['suite', 'skill', 'style', 'genre', 'runtime'])

function groupOf(kind, manifest) {
  if (kind === 'skill') return '技能包'
  if (kind === 'style') return '文风包'
  if (kind === 'genre') return '体裁包'
  if (kind === 'runtime') return '运行时套件'
  if (Array.isArray(manifest?.supplies) && manifest.supplies.includes('deduce-rule')) return '推演规则包'
  return '业务套装'
}

/** 所有投影共用的 module@2 基线；不声明第二份真源。 */
function baseManifest(raw, kind) {
  const checked = validateModuleManifest(raw, { dirName: raw.id })
  if (!checked.ok) return null
  return Object.freeze({ ...checked.manifest, kind, group: groupOf(kind, raw) })
}

function projectSkill(skill) {
  return baseManifest({
    spec: MODULE_SPEC,
    id: skill.name,
    name: skill.name,
    version: version3(skill.version, '0.0.0'),
    class: 'suite',
    builtin: skill.source === '内置',
    description: skill.description,
    supplies: ['skill'],
    entries: { skill: 'SKILL.md' },
    appliesTo: [{ id: 'agent.runtime', min: 1 }],
    deps: [],
    settings: []
  }, 'skill')
}

function projectStyle(pack) {
  return baseManifest({
    spec: MODULE_SPEC,
    id: pack.id,
    name: pack.name,
    version: '0.1.0',
    class: 'suite',
    builtin: pack.source === '内置',
    description: pack.description,
    supplies: ['resource'],
    resourceKind: 'style',
    entries: { resource: `${pack.id}.json` },
    appliesTo: [],
    deps: [],
    settings: []
  }, 'style')
}

function projectGenre(genre) {
  return baseManifest({
    spec: MODULE_SPEC,
    id: genre.id,
    name: genre.name,
    version: '0.1.0',
    class: 'suite',
    builtin: genre.source === '内置',
    description: genre.summary,
    supplies: ['resource'],
    resourceKind: 'genre',
    entries: { resource: `${genre.id}.json` },
    appliesTo: [{ id: 'storage.scaffold', min: 1 }, { id: 'prose.write', min: 1 }],
    deps: [],
    settings: []
  }, 'genre')
}

function projectRuntime(kit) {
  return baseManifest({
    spec: MODULE_SPEC,
    id: kit.id,
    name: kit.name,
    version: '0.1.0',
    class: 'suite',
    builtin: kit.source === '内置',
    description: kit.description,
    supplies: ['runtime'],
    entries: { runtime: 'manifest.json' },
    appliesTo: [{ id: 'agent.runtime', min: 1 }],
    deps: [],
    settings: []
  }, 'runtime')
}

/** suites 已是 module@2：从 normalizeSuite 的规整结果投影，不重复解析 manifest。 */
function projectSuite(suite) {
  return baseManifest({
    spec: MODULE_SPEC,
    id: suite.id,
    name: suite.name,
    version: suite.version,
    class: 'suite',
    builtin: suite.builtin === true,
    description: suite.description,
    supplies: suite.supplies,
    entries: suite.entries,
    appliesTo: suite.appliesTo,
    deps: suite.requires ?? [],
    settings: suite.capabilities?.settings?.mode === 'schema' ? suite.capabilities.settings.schema : []
  }, 'suite')
}

/**
 * 五类货架一次装载。
 * @returns {{manifests: object[], records: object[], overrides: object[], warnings: object[]}}
 *   manifests —— 能力图唯一套件清单（module@2，冻结）
 *   records   —— 治理视图（含来源、启停读值所需的 group/entries/deps）
 *   overrides —— 本机层覆盖内置层的显式报告（谁覆盖谁、各自目录）
 */
export function loadShelfFacts({
  suitesDirs = [], skillsDirs = [], stylesDirs = [], genresDirs = [], runtimesDirs = [],
  loadSuites: loadSuitesOverride,
  appVersion
} = {}) {
  const warnings = []
  const byId = new Map()
  const overrides = []
  const add = (manifest, record) => {
    if (!manifest) return
    if (!Object.prototype.hasOwnProperty.call(record, 'order')) record.order = byId.size
    if (byId.has(manifest.id)) {
      const previous = byId.get(manifest.id)
      record.order = previous.record.order
      overrides.push(Object.freeze({
        id: manifest.id,
        group: manifest.group,
        shadowed: Object.freeze({ source: previous.record.source, dir: previous.record.dir, name: previous.record.name }),
        shadowBy: Object.freeze({ source: record.source, dir: record.dir, name: record.name })
      }))
      byId.set(manifest.id, { manifest, record })
      return
    }
    byId.set(manifest.id, { manifest, record })
  }

  const sourceOf = (index) => index === 0 ? '内置' : '本机'
  // 逐目录装载（域加载器自身会按 id 去重）——覆盖必须在这里显式看见，不能被上游悄悄洗掉。
  {
    for (const [index, dir] of (suitesDirs ?? []).entries()) {
      if (!text(dir).trim()) continue
      // 同一目录喂两遍，让加载器分别按「内置/本机」口径验 builtin；只取需要的那一遍。
      const wantedSource = sourceOf(index)
      const shelf = (typeof loadSuitesOverride === 'function' ? loadSuitesOverride : loadSuites)([dir, dir])
      for (const warning of shelf.warnings ?? []) warnings.push({ kind: 'suite', ...warning })
      for (const raw of (shelf.suites ?? []).filter((item) => item.source === wantedSource)) {
        const suite = { ...raw, source: wantedSource, builtin: index === 0 }
        const manifest = projectSuite(suite)
        if (!manifest) continue
        add(manifest, {
          raw: suite,
          ...suite,
          kind: 'suite',
          group: groupOf('suite', manifest),
          dir: text(suite.dir),
          requires: suite.requires ?? [],
          entries: suite.entries ?? {},
          appliesTo: suite.appliesTo ?? []
        })
      }
    }
  }

  try {
    for (const [index, dir] of (skillsDirs ?? []).entries()) {
      // 目录项可为 { dir, source }（套件捆绑技能）——与 loadSkills 同口径，不另开加载器。
      const bundled = typeof dir === 'object' && dir !== null
      const real = bundled ? text(dir.dir) : text(dir)
      if (!real.trim()) continue
      const loaded = loadSkills(bundled ? [dir] : [real])
      for (const warning of loaded.warnings ?? []) warnings.push({ kind: 'skill', ...warning })
      for (const raw of loaded.skills ?? []) {
        const skill = { ...raw, source: bundled ? text(dir.source) || sourceOf(index) : sourceOf(index) }
        const manifest = projectSkill(skill)
        if (!manifest) continue
        add(manifest, {
          raw: skill,
          id: skill.name,
          name: skill.name,
          version: version3(skill.version, '0.0.0'),
          vendor: skill.vendor || skill.source,
          description: skill.description,
          domains: skill.genres ?? [],
          builtin: index === 0,
          source: skill.source,
          dir: text(skill.dir),
          kind: 'skill',
          group: groupOf('skill', manifest),
          supplies: ['skill'],
          entries: { skill: 'SKILL.md' },
          appliesTo: manifest.appliesTo,
          requires: [],
          capabilities: { settings: { mode: 'none' }, pages: [], services: [] }
        })
      }
    }
  } catch (error) {
    warnings.push({ kind: 'skill', code: 'SKILLS_UNREADABLE', message: `技能清单读不了：${text(error?.message || error)}` })
  }

  try {
    for (const [index, dir] of (stylesDirs ?? []).entries()) {
      if (!text(dir).trim()) continue
      const loaded = loadStylePacksSync([dir])
      for (const warning of loaded.warnings ?? []) warnings.push({ kind: 'style', ...warning })
      for (const raw of loaded.styles ?? []) {
        const pack = { ...raw, source: sourceOf(index) }
        const manifest = projectStyle(pack)
        if (!manifest) continue
        add(manifest, {
          raw: pack,
          id: pack.id,
          name: pack.name,
          version: '0.1.0',
          vendor: pack.source,
          description: pack.description,
          domains: [],
          builtin: index === 0,
          source: pack.source,
          dir: text(pack.dir),
          kind: 'style',
          group: groupOf('style', manifest),
          supplies: ['resource'],
          resourceKind: 'style',
          entries: { resource: `${pack.id}.json` },
          appliesTo: [],
          requires: [],
          capabilities: { settings: { mode: 'none' }, pages: [], services: [] },
          tokens: pack.tokens
        })
      }
    }
  } catch (error) {
    warnings.push({ kind: 'style', code: 'STYLES_UNREADABLE', message: `文风包清单读不了：${text(error?.message || error)}` })
  }

  try {
    for (const [index, dir] of (genresDirs ?? []).entries()) {
      if (!text(dir).trim()) continue
      const loaded = loadGenres([dir])
      for (const warning of loaded.warnings ?? []) warnings.push({ kind: 'genre', ...warning })
      for (const raw of loaded.genres ?? []) {
        const genre = { ...raw, source: sourceOf(index) }
        const manifest = projectGenre(genre)
        if (!manifest) continue
        add(manifest, {
          raw: genre,
          id: genre.id,
          name: genre.name,
          version: '0.1.0',
          vendor: genre.source,
          description: genre.summary,
          domains: genre.deliverables ?? [],
          builtin: index === 0,
          source: genre.source,
          dir: text(genre.dir),
          kind: 'genre',
          group: groupOf('genre', manifest),
          supplies: ['resource'],
          resourceKind: 'genre',
          entries: { resource: `${genre.id}.json` },
          appliesTo: manifest.appliesTo,
          requires: [],
          capabilities: { settings: { mode: 'none' }, pages: [], services: [] }
        })
      }
    }
  } catch (error) {
    warnings.push({ kind: 'genre', code: 'GENRES_UNREADABLE', message: `体裁包清单读不了：${text(error?.message || error)}` })
  }

  try {
    for (const [index, dir] of (runtimesDirs ?? []).entries()) {
      if (!text(dir).trim()) continue
      const loaded = loadRuntimeKits([dir])
      for (const warning of loaded.warnings ?? []) warnings.push({ kind: 'runtime', ...warning })
      for (const raw of loaded.kits ?? []) {
        const kit = { ...raw, source: sourceOf(index) }
        const manifest = projectRuntime(kit)
        if (!manifest) continue
        add(manifest, {
          raw: kit,
          id: kit.id,
          name: kit.name,
          version: '0.1.0',
          vendor: kit.source,
          description: kit.description,
          domains: [kit.kind, kit.category].filter(Boolean),
          builtin: index === 0,
          source: kit.source,
          dir: text(kit.dir),
          kind: 'runtime',
          group: groupOf('runtime', manifest),
          supplies: ['runtime'],
          entries: { runtime: 'manifest.json' },
          appliesTo: manifest.appliesTo,
          requires: [],
          fixture: kit.fixture === true,
          capabilities: { settings: { mode: 'none' }, pages: [], services: [] }
        })
      }
    }
  } catch (error) {
    warnings.push({ kind: 'runtime', code: 'RUNTIMES_UNREADABLE', message: `运行时清单读不了：${text(error?.message || error)}` })
  }

  const ordered = [...byId.values()]
  ordered.sort((a, b) => a.manifest.group.localeCompare(b.manifest.group, 'zh-Hans-CN') || a.manifest.id.localeCompare(b.manifest.id))
  return {
    manifests: Object.freeze(ordered.map((item) => item.manifest)),
    records: Object.freeze(ordered.map((item) => Object.freeze(item.record))),
    overrides: Object.freeze(overrides),
    warnings: Object.freeze(warnings)
  }
}

/** 能力图唯一套件清单来源。数组入参兼容旧调用（＝suitesDirs）。 */
export function loadShelfCapabilityManifests(opts = {}) {
  const options = Array.isArray(opts) ? { suitesDirs: opts } : opts
  return loadShelfFacts(options).manifests
}

/**
 * 各货架原有读取端点的取数口：形状仍是各自域的原始事实，但来源只有统一清单这一处。
 * 域适配器把 raw 随记录带出；这里只按 kind 取出并过滤该域的 warning，不改响应形状。
 */
export function shelfDomainData(opts, kind) {
  const facts = loadShelfFacts(opts)
  return {
    items: facts.records.filter((record) => record.kind === kind)
      .sort((a, b) => a.order - b.order)
      .map((record) => record.raw).filter(Boolean),
    warnings: facts.warnings.filter((warning) => warning.kind === kind)
  }
}

/** 同步读套件状态（启停由统一 suite-state.json 管，能力图无库时回落机器级）。 */
export function readShelfSuiteState({ root = '', machinePath = '' } = {}) {
  const { path } = resolveSuiteStatePath({ root, machinePath, mode: 'read' })
  if (!text(path).trim() || !existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && parsed.suites && typeof parsed.suites === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
