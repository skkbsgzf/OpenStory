/**
 * OpenStory 业务套件（插件）系统（OS-15）——DSH 插件同构：版本号/归属/独立设置页/非常驻。
 *
 * 套件＝目录＋manifest（openstory-suite@1）：
 *   内置 openstory/suites/ ＋本机 %LOCALAPPDATA%/PinaxNext/openstory/suites/（本机按 id 覆盖内置）。
 * manifest 声明 settings schema（string/number/boolean/select），值存本机 suite-state.json：
 *   { suites: { <id>: { enabled: boolean, values: {...}, updatedAt } } }——enabled 缺省 true，
 *   停用＝该套件的规则退回内置默认（非常驻的落地点），值保留不丢。
 * 与 Agent 运行时 kit（OS-9）分工：kit 管「模型对话走哪条通道」，套件管「业务域的默认规则」。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSkills } from './skills.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const SUITE_SPEC = 'openstory-suite@2'
export const SUITE_SPEC_LEGACY = 'openstory-suite@1'
const SETTING_TYPES = new Set(['string', 'number', 'boolean', 'select'])

function text(value) {
  return String(value ?? '')
}

export function builtinSuitesDir() {
  return join(HERE, 'suites')
}

export function defaultUserSuitesDir(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'suites') : ''
}

export function defaultSuiteStatePath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'suite-state.json') : ''
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

function normalizeSettingsSchema(rawSettings, bad) {
  const settings = []
  for (const setting of Array.isArray(rawSettings) ? rawSettings : []) {
    const key = text(setting?.key).trim()
    if (!/^[\w.]{1,40}$/u.test(key)) return bad('SUITE_SETTING_KEY', `settings 字段 key 非法：${text(setting?.key)}`)
    const type = text(setting?.type).trim()
    if (!SETTING_TYPES.has(type)) return bad('SUITE_SETTING_TYPE', `settings ${key} 的 type 非法（string/number/boolean/select）`)
    const label = text(setting?.label).trim() || key
    if (type === 'select' && (!Array.isArray(setting.options) || setting.options.length === 0)) {
      return bad('SUITE_SETTING_OPTIONS', `select 字段 ${key} 缺 options`)
    }
    if (type === 'select' && !setting.options.map((option) => text(option)).includes(text(setting.default))) {
      return bad('SUITE_SETTING_DEFAULT', `select 字段 ${key} 的 default 不在 options 里`)
    }
    settings.push({ key, label, type, ...(setting.options ? { options: setting.options.map((option) => text(option)) } : {}), ...(setting.default !== undefined ? { default: setting.default } : {}) })
  }
  return settings
}

const ASSET_ENTRY = /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff. -]{0,60}\.(?:html?|mjs|js|css|json)$/u

/**
 * 能力声明规整（OS-16 协议 v2）：settings 两模式（schema＝宿主渲染表单；page＝套件自带设置页经
 * /suite-assets 同源装载）＋pages/services 登记位。@1 的顶层 settings[] 自动按 schema 模式兼容。
 */
function normalizeCapabilities(raw, dir, bad) {
  const source = raw
  if (source === undefined || source === null) {
    return { ok: true, capabilities: { settings: { mode: 'none' }, pages: [], services: [] } }
  }
  if (typeof source !== 'object' || Array.isArray(source)) return bad('SUITE_CAPS_SHAPE', 'capabilities 必须是对象')
  const caps = { settings: { mode: 'none' }, pages: [], services: [] }
  const settings = source.settings
  if (settings !== undefined) {
    if (typeof settings !== 'object' || settings === null) return bad('SUITE_CAPS_SETTINGS', 'capabilities.settings 必须是对象')
    const mode = text(settings.mode).trim()
    if (mode === 'schema') {
      const schema = normalizeSettingsSchema(settings.schema, bad)
      if (!Array.isArray(schema)) return schema // bad 载荷（{ok:false, warning}）
      caps.settings = { mode: 'schema', schema }
    } else if (mode === 'page') {
      const entry = text(settings.entry).trim()
      if (!ASSET_ENTRY.test(entry)) return bad('SUITE_CAPS_ENTRY', `page 模式缺合法 entry（如 settings.html）：${entry}`)
      if (!existsSync(join(dir, entry))) return bad('SUITE_CAPS_ENTRY_MISSING', `自带设置页文件不在套件目录里：${entry}`)
      caps.settings = { mode: 'page', entry }
    } else {
      return bad('SUITE_CAPS_MODE', 'settings.mode 只许 schema/page')
    }
  }
  for (const page of Array.isArray(source.pages) ? source.pages : []) {
    const pageId = text(page?.id).trim()
    const pageEntry = text(page?.entry).trim()
    if (!/^[\w-]{1,40}$/u.test(pageId) || !ASSET_ENTRY.test(pageEntry)) {
      return bad('SUITE_CAPS_PAGES', `pages 项非法（id/entry）：${text(page?.id)} / ${pageEntry}`)
    }
    caps.pages.push({ id: pageId, title: text(page?.title).trim() || pageId, entry: pageEntry })
  }
  for (const service of Array.isArray(source.services) ? source.services : []) {
    if (!service || typeof service !== 'object' || !/^[\w-]{1,40}$/u.test(text(service.id))) {
      return bad('SUITE_CAPS_SERVICES', 'services 项必须有合法 id')
    }
    caps.services.push({ id: text(service.id), description: text(service.description).trim() })
  }
  return { ok: true, capabilities: caps }
}

/** 单套件规整：spec（@2 能力声明／@1 兼容）逐项把门，问题随 warning 报。 */
export function normalizeSuite(raw, { source, dir } = {}) {
  const where = `${source}·${text(dir)}`
  const bad = (code, message) => ({ ok: false, warning: { code, dir: where, message: `${message}：${where}` } })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('SUITE_SHAPE', 'manifest 不是对象')
  const spec = text(raw.schemaVersion).trim()
  if (spec !== SUITE_SPEC && spec !== SUITE_SPEC_LEGACY) {
    return bad('SUITE_SPEC', `schemaVersion 必须是 ${SUITE_SPEC}（或兼容 ${SUITE_SPEC_LEGACY}）`)
  }
  const id = text(raw.id).trim()
  if (!/^[\w-]{1,40}$/u.test(id)) return bad('SUITE_ID', 'id 非法（只许字母数字-_，≤40 字）')
  const name = text(raw.name).trim()
  if (!name) return bad('SUITE_NAME', '缺 name')
  const version = text(raw.version).trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) return bad('SUITE_VERSION', 'version 必须是三段数字（如 0.1.0）')
  const vendor = text(raw.vendor).trim()
  if (!vendor) return bad('SUITE_VENDOR', '缺 vendor（归属）')
  const domains = Array.isArray(raw.domains) ? raw.domains.map((item) => text(item).trim()).filter(Boolean) : []
  // 能力声明：@2 读 capabilities；@1 的顶层 settings[] 等价于 schema 模式。
  const capsRaw = spec === SUITE_SPEC
    ? raw.capabilities
    : (Array.isArray(raw.settings) ? { settings: { mode: 'schema', schema: raw.settings } } : undefined)
  const capsResult = normalizeCapabilities(capsRaw, resolve(text(dir)), bad)
  if (!capsResult.ok) return capsResult // bad 载荷（{ok:false, warning}）
  return {
    ok: true,
    suite: {
      id,
      name,
      version,
      vendor,
      description: text(raw.description).trim(),
      domains,
      capabilities: capsResult.capabilities,
      source,
      dir: resolve(text(dir))
    }
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
    suites.push(normalized.suite)
  }
  return suites
}

/** 货架装载：内置＋本机（本机按 id 覆盖内置）。 */
export function loadSuites(dirs = []) {
  const warnings = []
  const byId = new Map()
  dirs.forEach((dir, index) => {
    const source = index === 0 ? '内置' : '本机'
    for (const suite of scanSuiteDir(dir, source, warnings)) byId.set(suite.id, suite)
  })
  return { suites: [...byId.values()], warnings }
}

/* ---------- 套件状态（enabled＋values，本机单文件原子写）---------- */

function emptyState() {
  return { suites: {} }
}

export async function loadSuiteState(statePath) {
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

async function saveSuiteState(statePath, state) {
  await writeFileAtomic(statePath, JSON.stringify(state, null, 2))
}

async function writeFileAtomic(path, content) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, path)
}

/** 套件公开形状：能力声明＋（schema 模式）按 schema 归一的当前值＋enabled。 */
export function suitePublic(suite, suiteState) {
  const entry = suiteState?.suites?.[suite.id] ?? {}
  const enabled = entry.enabled !== false
  // 捆绑技能清单（OS-68）：套件 skills/ 下的手艺配方，随套件启停生效——详情页展示用
  let bundledSkills = []
  try {
    const skillsDir = join(text(suite.dir), 'skills')
    if (existsSync(skillsDir)) bundledSkills = loadSkills([{ dir: skillsDir, source: suite.name }]).skills
      .map((skill) => ({ name: skill.name, category: skill.category, summary: skill.description }))
  } catch { bundledSkills = [] }
  const settingsMode = suite.capabilities.settings.mode
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
  } else if (settingsMode === 'page') {
    values = entry.values && typeof entry.values === 'object' ? entry.values : {}
  }
  return {
    id: suite.id,
    name: suite.name,
    version: suite.version,
    vendor: suite.vendor,
    description: suite.description,
    domains: suite.domains,
    enabled,
    values,
    capabilities: suite.capabilities,
    ...(settingsSchema ? { settingsSchema } : {}),
    bundledSkills,
    source: suite.source
  }
}

/** 全货架公开清单（按 state 合并 enabled/values）。 */
export async function listSuitesPublic(dirs, statePath) {
  const { suites, warnings } = loadSuites(dirs)
  const { state } = await loadSuiteState(statePath)
  return { ok: true, suites: suites.map((suite) => suitePublic(suite, state)), warnings }
}

/** 按 schema 校验并保存一套件的 values；未知键丢弃，坏值 400 语义返回。page 模式套件不走这里。 */
export async function saveSuiteSettings(dirs, statePath, id, values) {
  const { suites } = loadSuites(dirs)
  const suite = suites.find((item) => item.id === id)
  if (!suite) return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  const capsSettings = suite.capabilities.settings
  if (capsSettings.mode !== 'schema') {
    return { ok: false, code: 'INVALID_ENTRY', message: `套件 ${id} 是自带设置页模式：配置经 /api/suite/state-data 通道，宿主不代管表单` }
  }
  const clean = {}
  for (const setting of capsSettings.schema) {
    const result = validateSettingValue(setting, values?.[setting.key])
    if (!result.ok) return { ok: false, code: 'INVALID_ENTRY', message: result.reason }
    if (result.value !== undefined) clean[setting.key] = result.value
  }
  const { state } = await loadSuiteState(statePath)
  const entry = state.suites[id] ?? {}
  state.suites[id] = { ...entry, enabled: entry.enabled !== false, values: clean, updatedAt: new Date().toISOString() }
  await saveSuiteState(statePath, state)
  return { ok: true, values: suitePublic(suite, state).values }
}

/** 启停（非常驻的开关）；停用不清值。 */
export async function setSuiteEnabled(dirs, statePath, id, enabled) {
  const { suites } = loadSuites(dirs)
  if (!suites.some((item) => item.id === id)) {
    return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  }
  const { state } = await loadSuiteState(statePath)
  const entry = state.suites[id] ?? {}
  state.suites[id] = { ...entry, enabled: enabled === true, values: entry.values ?? {}, updatedAt: new Date().toISOString() }
  await saveSuiteState(statePath, state)
  return { ok: true, enabled: enabled === true }
}

/** 工作台接线读值：套件启用才给值，否则回内置默认（调用方自定 fallback）。schema 模式限定。 */
export async function suiteValue(dirs, statePath, id, key, fallback) {
  const { suites } = loadSuites(dirs)
  const suite = suites.find((item) => item.id === id)
  if (!suite) return fallback
  const capsSettings = suite.capabilities.settings
  if (capsSettings.mode !== 'schema') return fallback
  const { state } = await loadSuiteState(statePath)
  const entry = state.suites[id] ?? {}
  if (entry.enabled === false) return fallback
  const setting = capsSettings.schema.find((item) => item.key === key)
  if (!setting) return fallback
  const given = entry.values?.[key]
  if (given === undefined || given === null || given === '') {
    return setting.default !== undefined ? setting.default : fallback
  }
  return given
}

/** page 模式套件的原始配置读取（值＝任意 JSON 对象，宿主不校验形状）。 */
export async function getSuiteStateData(dirs, statePath, id) {
  const { suites } = loadSuites(dirs)
  if (!suites.some((item) => item.id === id)) {
    return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  }
  const { state } = await loadSuiteState(statePath)
  const entry = state.suites[id] ?? {}
  const values = entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values) ? entry.values : {}
  return { ok: true, id, values }
}

/** page 模式套件的原始配置保存（整对象替换；宿主不校验形状）。 */
export async function saveSuiteStateData(dirs, statePath, id, values) {
  const { suites } = loadSuites(dirs)
  if (!suites.some((item) => item.id === id)) {
    return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个套件：${id}` }
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, code: 'INVALID_ENTRY', message: 'values 必须是 JSON 对象（page 模式套件自管形状）' }
  }
  const { state } = await loadSuiteState(statePath)
  const entry = state.suites[id] ?? {}
  state.suites[id] = { ...entry, enabled: entry.enabled !== false, values, updatedAt: new Date().toISOString() }
  await saveSuiteState(statePath, state)
  return { ok: true, values }
}
