/**
 * OpenStory 业务套件（插件）系统 —— OS-192：套件＝module@2。
 *
 * 五类货架（skills/styles/genres/runtimes/suites）经 protocol/shelfManifests.mjs 投影成同一形状：
 * 一个装载入口、一套启停与状态（库内 .openstory/plugins/suite-state.json）、依赖闭包。
 * 本文件只保留 suites 目录的读取/校验与统一治理的读写，不再有 legacy page 模式。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'
import { loadSkills } from './skills.mjs'
import { readAppVersion, minVersionGate } from '../protocol/versionGate.mjs'
import { resolveSuiteDependencies } from '../protocol/dependencyGraph.mjs'
import { courtyardPath } from '../protocol/courtyard.mjs'
import { MODULE_SPEC, validateModuleManifest } from '../protocol/moduleManifest.mjs'
import { loadShelfFacts, loadShelfCapabilityManifests } from '../protocol/shelfManifests.mjs'

export { loadShelfCapabilityManifests, loadShelfCapabilityManifests as loadSuiteCapabilityManifests } from '../protocol/shelfManifests.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** OS-140 布局归一：本模块迁到 src/services/——货架数据目录（suites/）仍在仓根。 */
const REPO_ROOT = join(HERE, '..', '..')

export const SUITE_SPEC = MODULE_SPEC

function text(value) {
  return String(value ?? '')
}

export function builtinSuitesDir() {
  return join(REPO_ROOT, 'suites')
}

export function defaultUserSuitesDir(env = process.env) {
  return courtyardPath(env, 'openstory', 'suites')
}

export function defaultSuiteStatePath(env = process.env) {
  return courtyardPath(env, 'openstory', 'suite-state.json')
}

/** settings schema 单字段校验；返回 {ok} 或 {ok:false, reason}。 */
export function validateSettingValue(setting, value) {
  const type = text(setting?.type)
  const key = text(setting?.key)
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined } // 空值＝回落 default
  }
  if (type === 'string' && typeof value === 'string') return { ok: true, value }
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return { ok: true, value }
  if (type === 'boolean' && typeof value === 'boolean') return { ok: true, value }
  if (type === 'select' && typeof value === 'string') {
    const options = Array.isArray(setting.options) ? setting.options.map((option) => text(option)) : []
    if (options.includes(value)) return { ok: true, value }
    return { ok: false, reason: `${key} 的值必须是 ${options.join('／')} 之一` }
  }
  return { ok: false, reason: `${key} 需要 ${type} 类型的值` }
}

/**
 * OS-191：module@2 suite 目录只许数据与说明——扩展名白名单。
 * 数据 .json/.md/.txt/.yaml/.yml/.css，位图 .png/.jpg/.jpeg/.webp/.gif/.ico，字体 .woff2。
 * HTML、SVG、WASM 与任何脚本扩展名一律拒收（理由不变：套件只许数据与说明）。
 */
const SUITE_DATA_FILE = /\.(?:json|md|txt|yaml|yml|css|png|jpg|jpeg|webp|gif|ico|woff2)$/iu

function findExecutableInSuite(dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true })
  } catch {
    return null
  }
  for (const item of entries) {
    if (!item.isFile()) continue
    if (!SUITE_DATA_FILE.test(item.name)) return join(item.parentPath ?? dir, item.name)
  }
  return null
}

/**
 * 单套件规整：只认 module@2 class:suite。
 * entries 必须落在套件目录内；携带任何脚本/HTML 一律拒收。
 */
export function normalizeSuite(raw, { source, dir, appVersion } = {}) {
  const where = `${source}·${text(dir)}`
  const bad = (code, message) => ({ ok: false, warning: { code, dir: where, message: `${message}：${where}` } })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('SUITE_SHAPE', 'manifest 不是对象')
  if (text(raw.spec).trim() !== MODULE_SPEC) {
    return bad('SUITE_SPEC', `spec 必须是 ${MODULE_SPEC}（openstory-suite@1/@2 页面模式已退役）`)
  }
  const suiteDir = resolve(text(dir))
  const validated = validateModuleManifest(raw, { dirName: basename(suiteDir) })
  if (!validated.ok) return bad('SUITE_MODULE_SHAPE', validated.errors.join('；'))
  const manifest = validated.manifest
  const extraWarnings = []
  if (manifest.builtin !== (source === '内置')) {
    return bad('SUITE_BUILTIN_MISMATCH', `builtin 必须与装载源一致（${source}）`)
  }
  // 版本写坏时校验器不会把它带进 manifest——闸必须读原值才能给出 _BAD warning（fail-open）。
  const gate = minVersionGate(raw.minOpenStoryVersion, appVersion ?? readAppVersion(), { prefix: 'SUITE', label: '套件', where })
  if (gate.skip) return bad('SUITE_MIN_VERSION', gate.message)
  if (gate.warning) extraWarnings.push(gate.warning)
  for (const [supply, entry] of Object.entries(manifest.entries)) {
    const normalized = text(entry).replaceAll('\\', '/').replace(/^\.\//u, '')
    const segments = normalized.split('/')
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)
      || segments.some((part) => !part || part === '.' || part === '..')) {
      return bad('SUITE_ENTRY_INVALID', `entries.${supply} 越出套件目录：${entry}`)
    }
    if (!existsSync(join(suiteDir, ...segments))) {
      return bad('SUITE_ENTRY_MISSING', `entries.${supply} 指向的文件不在套件目录里：${entry}`)
    }
  }
  const executable = findExecutableInSuite(suiteDir)
  if (executable) {
    return bad('SUITE_EXECUTABLE_CODE', `套件只许数据与说明，不得携带可执行代码：${executable.slice(suiteDir.length + 1)}`)
  }
  const settings = manifest.settings ?? []
  return {
    ok: true,
    suite: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      vendor: source === '内置' ? 'skkbsgzf' : '本机',
      description: manifest.description,
      domains: [],
      ...(manifest.deps.length ? { requires: manifest.deps } : {}),
      capabilities: {
        settings: settings.length ? { mode: 'schema', schema: settings } : { mode: 'none' },
        pages: [],
        services: []
      },
      supplies: manifest.supplies,
      entries: manifest.entries,
      appliesTo: manifest.appliesTo,
      builtin: manifest.builtin,
      ...(manifest.resourceKind ? { resourceKind: manifest.resourceKind } : {}),
      ...(manifest.minOpenStoryVersion ? { minOpenStoryVersion: manifest.minOpenStoryVersion } : {}),
      source,
      dir: suiteDir
    },
    ...(extraWarnings.length ? { warnings: extraWarnings } : {})
  }
}

/** 目录同步扫描（没有 manifest.json 的子目录＝不是套件，静默跳过）。 */
function scanSuiteDir(dir, source, warnings) {
  const suites = []
  if (!text(dir).trim() || !existsSync(dir)) return suites
  let names = []
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name)
  } catch (error) {
    warnings.push({ code: 'SUITE_DIR_UNREADABLE', dir, message: `套件目录读不了：${dir}（${text(error?.message || error)}）` })
    return suites
  }
  for (const name of names) {
    const suiteDir = join(dir, name)
    const manifestPath = join(suiteDir, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    let raw = null
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      warnings.push({ code: 'SUITE_MANIFEST_UNREADABLE', dir: `${source}·${name}`, message: `manifest 读不了：${source}·${name}（${text(error?.message || error)}）` })
      continue
    }
    const normalized = normalizeSuite(raw, { source, dir: suiteDir })
    if (!normalized.ok) {
      warnings.push(normalized.warning)
      continue
    }
    for (const warning of normalized.warnings ?? []) warnings.push(warning)
    suites.push(normalized.suite)
  }
  return suites
}

/** suites 货架装载：内置＋本机（本机按 id 覆盖内置）。 */
export function loadSuites(dirs = []) {
  const warnings = []
  const byId = new Map()
  dirs.forEach((dir, index) => {
    const source = index === 0 ? '内置' : '本机'
    for (const suite of scanSuiteDir(dir, source, warnings)) byId.set(suite.id, suite)
  })
  return { suites: [...byId.values()], warnings }
}

/* ---------- 统一治理（启停＋设置值，五类货架共一份 suite-state.json）---------- */

function emptyState() {
  return { suites: {} }
}

/**
 * OS-160 单一路径入口：套件状态随库走，机器级文件降为缺省值。
 */
export function resolveSuiteStatePath({ root = '', machinePath = '', mode = 'read' } = {}) {
  const libPath = text(root).trim()
    ? join(text(root).trim(), '.openstory', 'plugins', 'suite-state.json')
    : ''
  if (libPath && (mode === 'write' || existsSync(libPath))) return { path: libPath, scope: 'library' }
  return { path: text(machinePath).trim(), scope: 'machine' }
}

export async function loadSuiteState(statePath, root = '') {
  const resolved = resolveSuiteStatePath({ root, machinePath: statePath, mode: 'read' })
  statePath = resolved.path
  if (!text(statePath).trim()) return { state: emptyState(), warnings: [] }
  try {
    const raw = await readFile(statePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.suites || typeof parsed.suites !== 'object') {
      return { state: emptyState(), warnings: [{ code: 'SUITE_STATE_SHAPE', message: '套件状态文件形状不对，按全新状态处理（不覆盖重写直到下次保存）' }] }
    }
    return { state: parsed, warnings: [] }
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: emptyState(), warnings: [] }
    return { state: emptyState(), warnings: [{ code: 'SUITE_STATE_CORRUPT', message: `套件状态读不了（按全新处理，保存时覆盖）：${text(error?.message || error)}` }] }
  }
}

async function saveSuiteState(statePath, state, root = '') {
  const resolved = resolveSuiteStatePath({ root, machinePath: statePath, mode: 'write' })
  statePath = resolved.path
  if (!text(statePath).trim()) return
  await mkdir(dirname(statePath), { recursive: true })
  await atomicWriteFile(statePath, JSON.stringify(state, null, 2))
}

/** 兼容旧的位置参数；新调用方传一个含五类目录的对象。 */
function unifyOpts(input, statePath = '', root = '') {
  if (input && !Array.isArray(input) && typeof input === 'object') return input
  return {
    suitesDirs: Array.isArray(input) ? input : [],
    skillsDirs: [], stylesDirs: [], genresDirs: [], runtimesDirs: [],
    suiteStatePath: text(statePath), root: text(root)
  }
}

/** 统一货架：五类都从这里取，不再有第二份清单。 */
function unifiedFacts(opts) {
  const o = unifyOpts(opts)
  return loadShelfFacts({
    suitesDirs: o.suitesDirs ?? [],
    skillsDirs: o.skillsDirs ?? [],
    stylesDirs: o.stylesDirs ?? [],
    genresDirs: o.genresDirs ?? [],
    runtimesDirs: o.runtimesDirs ?? []
  })
}

/** 套件公开形状：能力声明＋按 schema 归一的当前值＋enabled＋来源。 */
export function suitePublic(suite, suiteState) {
  const entry = suiteState?.suites?.[suite.id] ?? {}
  const enabled = entry.enabled !== false
  let bundledSkills = []
  try {
    const skillsDir = join(text(suite.dir), 'skills')
    if (existsSync(skillsDir)) bundledSkills = loadSkills([{ dir: skillsDir, source: suite.name }]).skills
      .map((skill) => ({ name: skill.name, category: skill.category, summary: skill.description }))
  } catch { bundledSkills = [] }
  const settingsMode = suite.capabilities?.settings?.mode ?? 'none'
  let values = {}
  let settingsSchema
  if (settingsMode === 'schema') {
    for (const setting of suite.capabilities.settings.schema) {
      const given = entry.values?.[setting.key]
      values[setting.key] = given === undefined || given === null || given === ''
        ? (setting.default !== undefined ? setting.default : '')
        : given
    }
    settingsSchema = suite.capabilities.settings.schema
  } else if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
    values = entry.values
  }
  const src = suite.sourceDetail ?? {}
  return {
    id: suite.id,
    name: suite.name,
    version: suite.version,
    vendor: suite.vendor,
    description: suite.description,
    domains: suite.domains ?? [],
    enabled,
    values,
    capabilities: suite.capabilities ?? { settings: { mode: 'none' }, pages: [], services: [] },
    ...(settingsSchema ? { settingsSchema } : {}),
    bundledSkills,
    kind: suite.kind ?? 'suite',
    group: suite.group ?? '业务套装',
    source: suite.source,
    // OS-99/OS-192：来源写全——内置/本机、物理目录、本机覆盖内置的报告点
    sourceDetail: {
      kind: src.kind || suite.source || '—',
      dir: src.dir || text(suite.dir),
      entry: '',
      shadowed: suite.shadowed === true,
      loadedFrom: src.loadedFrom || text(suite.source)
    }
  }
}

/** 全货架公开清单（五类统一；依赖闸覆盖 deps 与 appliesTo 之外的套件 id 依赖）。 */
export async function listSuitesPublic(opts, statePathArg = '', rootArg = '') {
  const o = unifyOpts(opts, statePathArg, rootArg)
  const facts = unifiedFacts(o)
  const { state } = await loadSuiteState(o.suiteStatePath ?? '', o.root ?? '')
  const enabledOf = (record) => state?.suites?.[record.id]?.enabled !== false
  const graph = resolveSuiteDependencies(
    facts.records.map((record) => ({ id: record.id, enabled: enabledOf(record), requires: record.requires }))
  )
  const unmetById = new Map(graph.unmet.map((item) => [item.id, item.needs]))
  const cycleById = new Map(graph.cycles.flat().map((id) => [id, graph.cycles.find((cycle) => cycle.includes(id))]))
  return {
    ok: true,
    suites: facts.records.map((record) => {
      const listed = suitePublic(record, state)
      const missing = unmetById.get(record.id)
      const cycle = cycleById.get(record.id)
      if (missing?.length || cycle) {
        listed.blocked = true
        listed.blockedReason = cycle ? `依赖成环：${cycle.join(' → ')}` : `缺依赖：${missing.join('、')}`
        listed.missingDependencies = missing ?? []
      }
      return listed
    }),
    overrides: facts.overrides,
    warnings: [...facts.warnings]
  }
}

/** 按 schema 校验并保存设置值；未知键丢弃，坏值 400 语义返回。 */
export async function saveSuiteSettings(opts, statePathArg, id, values, rootArg = '') {
  const o = unifyOpts(opts, text(statePathArg), text(rootArg))
  const { records } = unifiedFacts(o)
  const record = records.find((item) => item.id === id)
  if (!record) return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  const capsSettings = record.capabilities?.settings
  if (!capsSettings || capsSettings.mode !== 'schema') {
    return { ok: false, code: 'INVALID_ENTRY', message: `${id} 没有宿主代管的设置项` }
  }
  const clean = {}
  for (const setting of capsSettings.schema) {
    const result = validateSettingValue(setting, values?.[setting.key])
    if (!result.ok) return { ok: false, code: 'INVALID_ENTRY', message: result.reason }
    if (result.value !== undefined) clean[setting.key] = result.value
  }
  const { state } = await loadSuiteState(o.suiteStatePath ?? '', o.root ?? '')
  const entry = state.suites[id] ?? {}
  state.suites[id] = { ...entry, enabled: entry.enabled !== false, values: clean, updatedAt: new Date().toISOString() }
  await saveSuiteState(o.suiteStatePath ?? '', state, o.root ?? '')
  return { ok: true, values: suitePublic(record, state).values }
}

/** 启停（非常驻的开关）；停用不清值——对五类货架通用。 */
export async function setSuiteEnabled(opts, statePathArg, id, enabled, rootArg = '') {
  const o = unifyOpts(opts, text(statePathArg), text(rootArg))
  const { records } = unifiedFacts(o)
  if (!records.some((item) => item.id === id)) {
    return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  }
  const { state } = await loadSuiteState(o.suiteStatePath ?? '', o.root ?? '')
  const entry = state.suites[id] ?? {}
  state.suites[id] = { ...entry, enabled: enabled === true, values: entry.values ?? {}, updatedAt: new Date().toISOString() }
  await saveSuiteState(o.suiteStatePath ?? '', state, o.root ?? '')
  return { ok: true, enabled: enabled === true }
}

/** 工作台接线读值：套件启用才给值，否则回内置默认（调用方自定 fallback）。 */
export async function suiteValue(opts, statePathArg, id, key, fallback, rootArg = '') {
  const o = unifyOpts(opts, text(statePathArg), text(rootArg))
  const { records } = unifiedFacts(o)
  const record = records.find((item) => item.id === id)
  if (!record) return fallback
  const settings = record.capabilities?.settings
  if (!settings || settings.mode !== 'schema') return fallback
  const { state } = await loadSuiteState(o.suiteStatePath ?? '', o.root ?? '')
  const entry = state.suites[id] ?? {}
  if (entry.enabled === false) return fallback
  const setting = settings.schema.find((item) => item.key === key)
  if (!setting) return fallback
  const given = entry.values?.[key]
  if (given === undefined || given === null || given === '') {
    return setting.default !== undefined ? setting.default : fallback
  }
  return given
}
