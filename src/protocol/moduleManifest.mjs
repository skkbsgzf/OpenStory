/**
 * OS-192：module@2 manifest 校验唯一真源。
 * 拆到 protocol 低层是为了让货架投影（shelfManifests）与模块装载器（modules）
 * 共用同一张矩阵而不形成循环依赖。原 stage B / @1 双读与迁移入口已退役。
 */
import { isHostComposition } from './moduleIdentity.mjs'
import { isRegisteredSlot } from './slots.mjs'

export const MODULE_SPEC = 'openstory-module@2'
/** OS-192：@1 只作历史名词出现在告警里，不再有双读/迁移入口。 */
const RETIRED_MODULE_SPEC = 'openstory-module@1'

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/u
const CAPABILITY_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u
const VERSION_RE = /^\d+\.\d+\.\d+$/u
const SETTING_KEY_RE = /^[\w.]{1,40}$/u
const SETTING_TYPES = new Set(['string', 'number', 'boolean', 'select'])
const CLASSES = new Set(['kernel', 'workbench', 'suite'])
const SUPPLIES = new Set(['skill', 'deduce-rule', 'media-workflow', 'resource', 'runtime', 'bundle'])
const RESOURCE_KINDS = new Set(['style', 'genre'])
const COMMON_FIELDS = new Set([
  'spec', 'id', 'name', 'version', 'class', 'builtin', 'description', 'entry',
  'minOpenStoryVersion', 'capabilities', 'requires', 'optionalRequires', 'overrides',
  'migrations', 'endpoints', 'pages', 'slots', 'settings', 'settingsHint',
  'settingsJump', 'supplies', 'entries', 'resourceKind', 'appliesTo', 'deps'
])
const FORBIDDEN = Object.freeze({
  kernel: ['pages', 'slots', 'settings', 'settingsHint', 'settingsJump', 'supplies', 'entries', 'resourceKind', 'appliesTo', 'deps'],
  workbench: ['capabilities', 'migrations', 'supplies', 'entries', 'resourceKind', 'appliesTo', 'deps'],
  suite: ['entry', 'capabilities', 'requires', 'optionalRequires', 'migrations', 'endpoints', 'pages', 'slots', 'settingsHint', 'settingsJump']
})

function text(value) {
  return String(value ?? '')
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0
}

function frozenItems(items, normalize) {
  return Object.freeze(items.map((item) => Object.freeze(normalize(item))))
}

function stringList(value) {
  return Array.isArray(value) ? value : []
}

function validateStrings(errors, raw, key, { required = false } = {}) {
  const list = raw[key]
  if (list === undefined && !required) return []
  if (!Array.isArray(list)) {
    errors.push(`${key} 必须是数组`)
    return []
  }
  const seen = new Set()
  const values = []
  list.forEach((item, index) => {
    const value = text(item).trim()
    if (!value) errors.push(`${key}[${index}] 不能为空`)
    else if (seen.has(value)) errors.push(`${key} 重复：${value}`)
    else { seen.add(value); values.push(value) }
  })
  return values
}

function validateRanges(errors, raw, key) {
  const list = raw[key]
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push(`${key} 必须是数组`)
    return []
  }
  const seen = new Set()
  return list.map((item, index) => {
    if (!plainObject(item)) {
      errors.push(`${key}[${index}] 必须是对象`)
      return null
    }
    const id = text(item.id).trim()
    if (!CAPABILITY_RE.test(id)) errors.push(`${key}[${index}].id 非法：${id}`)
    if (!positiveInt(item.min)) errors.push(`${key}[${index}].min 必须是正整数`)
    if (item.maxExclusive !== undefined && (!positiveInt(item.maxExclusive) || item.maxExclusive <= item.min)) {
      errors.push(`${key}[${index}].maxExclusive 必须大于 min`)
    }
    if (seen.has(id)) errors.push(`${key} 重复能力：${id}`)
    seen.add(id)
    return { id, min: item.min, ...(item.maxExclusive !== undefined ? { maxExclusive: item.maxExclusive } : {}) }
  }).filter(Boolean)
}

function validateCapabilities(errors, raw) {
  const list = raw.capabilities
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('capabilities 必须是数组')
    return []
  }
  const seen = new Set()
  return list.map((item, index) => {
    if (!plainObject(item)) {
      errors.push(`capabilities[${index}] 必须是对象`)
      return null
    }
    const id = text(item.id).trim()
    if (!CAPABILITY_RE.test(id)) errors.push(`capabilities[${index}].id 非法：${id}`)
    if (!positiveInt(item.version)) errors.push(`capabilities[${index}].version 必须是正整数`)
    if (item.golden !== undefined && (typeof item.golden !== 'string' || !item.golden.trim())) {
      errors.push(`capabilities[${index}].golden 给了就必须是非空字符串`)
    }
    if (seen.has(id)) errors.push(`capabilities 重复能力：${id}`)
    seen.add(id)
    return { id, version: item.version, ...(item.golden !== undefined ? { golden: item.golden.trim() } : {}) }
  }).filter(Boolean)
}

function validateSettings(errors, raw) {
  const list = raw.settings
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('settings 必须是数组')
    return []
  }
  return list.map((setting, index) => {
    if (!plainObject(setting)) {
      errors.push(`settings[${index}] 必须是对象`)
      return null
    }
    const key = text(setting.key ?? setting.id).trim()
    if (!SETTING_KEY_RE.test(key)) {
      errors.push(`settings[${index}] key 非法：${key}`)
      return null
    }
    const type = text(setting.type).trim()
    if (!SETTING_TYPES.has(type)) {
      errors.push(`settings[${index}]（${key}）type 非法（string/number/boolean/select）`)
      return null
    }
    if (!text(setting.label).trim()) errors.push(`settings[${index}]（${key}）缺 label`)
    if (type === 'select') {
      const options = Array.isArray(setting.options) ? setting.options.map((option) => text(option)) : []
      if (options.length === 0) errors.push(`settings[${index}]（${key}）select 缺 options`)
      else if (setting.default !== undefined && !options.includes(text(setting.default))) {
        errors.push(`settings[${index}]（${key}）的 default 不在 options 里`)
      }
    }
    if (type === 'boolean' && setting.default !== undefined && typeof setting.default !== 'boolean') {
      errors.push(`settings[${index}]（${key}）boolean 的 default 必须是布尔值`)
    }
    if (type === 'number' && setting.default !== undefined && !Number.isFinite(setting.default)) {
      errors.push(`settings[${index}]（${key}）number 的 default 必须是数字`)
    }
    if (type === 'string' && setting.default !== undefined && typeof setting.default !== 'string') {
      errors.push(`settings[${index}]（${key}）string 的 default 必须是字符串`)
    }
    return { ...setting, key }
  }).filter(Boolean)
}

function validatePages(errors, raw) {
  const list = raw.pages
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('pages 必须是数组')
    return []
  }
  const seen = new Set()
  return list.map((page, index) => {
    if (!plainObject(page)) {
      errors.push(`pages[${index}] 必须是对象`)
      return null
    }
    const id = text(page.id ?? page.key).trim()
    if (!id) errors.push(`pages[${index}] 缺 id`)
    if (!text(page.label).trim()) errors.push(`pages[${index}] 缺 label`)
    if (seen.has(id)) errors.push(`pages 重复：${id}`)
    seen.add(id)
    const extra = Object.keys(page).filter((key) => !['id', 'label', 'kind', 'entry'].includes(key))
    if (extra.length) errors.push(`pages[${index}] 只允许 id/label/kind/entry，非法字段：${extra.join(',')}`)
    const kind = text(page.kind).trim()
    const entry = text(page.entry).trim()
    if (kind && kind !== 'iframe') errors.push(`pages[${index}].kind 只允许 iframe`)
    if (entry && kind !== 'iframe') errors.push(`pages[${index}] 声明 entry 时必须 kind:"iframe"`)
    if (kind === 'iframe' && !entry) errors.push(`pages[${index}] kind:"iframe" 必须声明 entry（包内 HTML）`)
    if (entry && (!/^[A-Za-z0-9._/-]+\.html$/u.test(entry) || entry.split('/').some((part) => part === '..' || part === '.'))) {
      errors.push(`pages[${index}].entry 必须是包内相对 HTML 路径`)
    }
    const normalized = { id, label: text(page.label).trim() }
    if (kind) normalized.kind = kind
    if (entry) normalized.entry = entry
    return normalized
  }).filter(Boolean)
}

function validateSlots(errors, raw, pages) {
  const list = raw.slots
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('slots 必须是数组')
    return []
  }
  const pageIds = new Set(pages.map((page) => page.id))
  const seen = new Set()
  return list.map((item, index) => {
    if (!plainObject(item)) {
      errors.push(`slots[${index}] 必须是对象`)
      return null
    }
    const extra = Object.keys(item).filter((key) => !['slot', 'page', 'order'].includes(key))
    if (extra.length) errors.push(`slots[${index}] 非法字段：${extra.join(',')}`)
    const slot = text(item.slot).trim()
    const page = text(item.page).trim()
    if (!isRegisteredSlot(slot)) errors.push(`slots[${index}].slot 未注册：${slot}`)
    if (!pageIds.has(page)) errors.push(`slots[${index}].page 不存在：${page}`)
    if (item.order !== undefined && !(Number.isInteger(item.order) && item.order >= 0)) {
      errors.push(`slots[${index}].order 必须是非负整数`)
    }
    const key = `${slot}:${page}`
    if (seen.has(key)) errors.push(`slots 重复：${key}`)
    seen.add(key)
    return { slot, page, ...(item.order !== undefined ? { order: item.order } : {}) }
  }).filter(Boolean)
}

function validateOverrides(errors, raw, klass) {
  const list = raw.overrides
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('overrides 必须是数组')
    return []
  }
  const allowedType = { kernel: 'capability', workbench: 'surface', suite: 'resource' }[klass]
  return list.map((item, index) => {
    if (!plainObject(item)) {
      errors.push(`overrides[${index}] 必须是对象`)
      return null
    }
    if (allowedType && item.type !== allowedType) errors.push(`overrides[${index}].type 必须是 ${allowedType}`)
    if (!text(item.target).trim()) errors.push(`overrides[${index}] 缺 target`)
    if (!positiveInt(item.from)) errors.push(`overrides[${index}].from 必须是正整数`)
    return { type: item.type, target: text(item.target).trim(), from: item.from }
  }).filter(Boolean)
}

function validateMigrations(errors, raw) {
  const list = raw.migrations
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push('migrations 必须是数组')
    return []
  }
  return list.map((item, index) => {
    if (!plainObject(item)) {
      errors.push(`migrations[${index}] 必须是对象`)
      return null
    }
    if (!CAPABILITY_RE.test(text(item.capability).trim())) errors.push(`migrations[${index}].capability 非法`)
    if (!positiveInt(item.from) || !positiveInt(item.to) || item.to !== item.from + 1) {
      errors.push(`migrations[${index}] 必须从 from 单向迁到 from+1`)
    }
    if (typeof item.entry !== 'string' || !item.entry.trim()) errors.push(`migrations[${index}] 缺 entry`)
    return { capability: text(item.capability).trim(), from: item.from, to: item.to, entry: item.entry.trim() }
  }).filter(Boolean)
}

function validateSuite(errors, raw) {
  const supplies = stringList(raw.supplies).map((item) => text(item).trim())
  supplies.forEach((item, index) => {
    if (!SUPPLIES.has(item)) errors.push(`supplies[${index}] 非法：${item}`)
  })
  if (new Set(supplies).size !== supplies.length) errors.push('supplies 重复')
  const entries = raw.entries
  if (entries !== undefined && !plainObject(entries)) errors.push('entries 必须是对象')
  if (plainObject(entries)) {
    for (const supply of supplies) {
      if (typeof entries[supply] !== 'string' || !entries[supply].trim()) errors.push(`entries 缺 ${supply}`)
    }
    for (const key of Object.keys(entries)) {
      if (!supplies.includes(key)) errors.push(`entries 含未声明供给：${key}`)
    }
  }
  if (supplies.includes('resource') && !RESOURCE_KINDS.has(raw.resourceKind)) {
    errors.push('resource 供给必须声明 resourceKind=style|genre')
  }
  if (raw.resourceKind !== undefined && !RESOURCE_KINDS.has(raw.resourceKind)) errors.push('resourceKind 非法')
  const deps = stringList(raw.deps).map((item) => text(item).trim())
  if (deps.some((item) => !item)) errors.push('deps 不能有空项')
  return { supplies, entries, deps }
}

export function validateModuleManifest(raw, { dirName = '' } = {}) {
  const errors = []
  const warnings = []
  if (!plainObject(raw)) return { ok: false, errors: ['manifest 必须是对象'], warnings }
  // OS-192：只剩一套规则（原 stage C）。@1 直接拒收并给出明确警告，不再双读/迁移。
  if (raw.spec === RETIRED_MODULE_SPEC) {
    errors.push(`${RETIRED_MODULE_SPEC} 已退役：请手工改造为 ${MODULE_SPEC}，不再提供自动迁移`)
  } else if (raw.spec !== MODULE_SPEC) {
    errors.push(`spec 必须是 ${MODULE_SPEC}`)
  }
  const id = text(raw.id).trim()
  if (!ID_RE.test(id)) errors.push('id 非法（小写字母开头，只许 a-z 0-9 -，≤40 字）')
  if (dirName && id !== dirName) errors.push(`id（${id}）必须与目录名（${dirName}）一致`)
  if (!text(raw.name).trim()) errors.push('缺 name')
  if (!VERSION_RE.test(text(raw.version).trim())) errors.push('version 必须是三段数字（如 0.1.0）')

  for (const key of Object.keys(raw)) {
    if (!COMMON_FIELDS.has(key)) errors.push(`未声明字段：${key}`)
  }
  if (raw.class !== undefined && !CLASSES.has(raw.class)) errors.push('class 只允许 kernel/workbench/suite')
  if (raw.builtin !== undefined && typeof raw.builtin !== 'boolean') errors.push('builtin 必须是布尔值')
  if (raw.core !== undefined) errors.push('core 已退役：工作台启停一律由 ui-state 与能力图判定')
  if (raw.class === undefined && !isHostComposition(id)) errors.push('class 必填（kernel/workbench/suite）')
  if (raw.minOpenStoryVersion !== undefined && !VERSION_RE.test(text(raw.minOpenStoryVersion).trim())) {
    warnings.push('MIN_VERSION_INVALID')
  }

  const klass = raw.class
  if (klass && FORBIDDEN[klass]) {
    for (const key of FORBIDDEN[klass]) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) errors.push(`${klass} 禁止字段：${key}`)
    }
  }
  if (!klass) {
    const classFields = isHostComposition(id)
      ? ['capabilities', 'overrides', 'migrations', 'slots', 'supplies', 'entries', 'resourceKind', 'appliesTo', 'deps']
      : ['entry', 'capabilities', 'requires', 'optionalRequires', 'overrides', 'migrations', 'slots', 'supplies', 'entries', 'resourceKind', 'appliesTo', 'deps']
    for (const key of classFields) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) errors.push(`缺 class 时不能声明 ${key}`)
    }
  }

  const endpoints = validateStrings(errors, raw, 'endpoints')
  const pages = validatePages(errors, raw)
  const slots = validateSlots(errors, raw, pages)
  const settings = validateSettings(errors, raw)
  for (const key of ['settingsHint', 'settingsJump']) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !raw[key].trim())) {
      errors.push(`${key} 给了就必须是非空字符串`)
    }
  }

  const capabilities = validateCapabilities(errors, raw)
  const requires = validateRanges(errors, raw, 'requires')
  const optionalRequires = validateRanges(errors, raw, 'optionalRequires')
  const appliesTo = validateRanges(errors, raw, 'appliesTo')
  const overrides = validateOverrides(errors, raw, klass)
  const migrations = validateMigrations(errors, raw)
  const suite = validateSuite(errors, raw)

  // OS-192：以下原 stage C 规则现在是无条件唯一规则；文风包（resource/style）消费方是底座界面，
  // 没有硬依赖，校验器只对它放宽 appliesTo 必须 ≥1 这一条。
  if (klass === 'kernel') {
    if (typeof raw.entry !== 'string' || !raw.entry.trim()) errors.push('kernel 必须声明 entry')
    if (!Array.isArray(raw.capabilities) || raw.capabilities.length < 1) errors.push('kernel capabilities 必须 ≥1')
  }
  if (klass === 'workbench') {
    if (typeof raw.entry !== 'string' || !raw.entry.trim()) errors.push('workbench 必须声明 entry')
    if (!Array.isArray(raw.requires) || raw.requires.length < 1) errors.push('workbench requires 必须 ≥1')
    if (!Array.isArray(raw.slots) || raw.slots.length < 1) errors.push('workbench slots 必须 ≥1')
  }
  if (klass === 'suite') {
    if (!Array.isArray(raw.supplies) || raw.supplies.length < 1) errors.push('suite supplies 必须 ≥1')
    if (!plainObject(raw.entries)) errors.push('suite 必须声明 entries')
    const styleOnly = suite.supplies.length === 1 && suite.supplies.includes('resource') && raw.resourceKind === 'style'
    if (!styleOnly && (!Array.isArray(raw.appliesTo) || raw.appliesTo.length < 1)) errors.push('suite appliesTo 必须 ≥1')
    if (suite.supplies.includes('bundle') && suite.deps.length < 1) errors.push('bundle deps 必须 ≥1')
  }
  if (isHostComposition(id)) {
    if (typeof raw.entry !== 'string' || !raw.entry.trim()) errors.push('宿主组合面必须声明 entry')
    if (!Array.isArray(raw.requires) || raw.requires.length < 1) errors.push('宿主组合面 requires 必须 ≥1')
  } else if (!klass) errors.push('class 必填（kernel/workbench/suite）')

  if (errors.length) return { ok: false, errors, warnings }
  const manifest = {
    spec: raw.spec,
    id,
    name: text(raw.name).trim(),
    version: text(raw.version).trim(),
    description: text(raw.description).trim(),
    endpoints: Object.freeze(endpoints),
    pages: Object.freeze(pages),
    settings: Object.freeze(settings)
  }
  if (klass) manifest.class = klass
  if (raw.builtin !== undefined) manifest.builtin = raw.builtin
  if (raw.entry !== undefined) manifest.entry = raw.entry.trim()
  if (raw.minOpenStoryVersion !== undefined && VERSION_RE.test(text(raw.minOpenStoryVersion).trim())) {
    manifest.minOpenStoryVersion = raw.minOpenStoryVersion.trim()
  }
  if (raw.slots !== undefined) manifest.slots = Object.freeze(slots)
  if (klass === 'kernel' || klass === 'workbench' || isHostComposition(id)) {
    manifest.requires = Object.freeze(requires)
    manifest.optionalRequires = Object.freeze(optionalRequires)
  }
  if (klass === 'kernel' || klass === 'workbench') manifest.overrides = Object.freeze(overrides)
  if (klass === 'kernel') {
    manifest.capabilities = Object.freeze(capabilities)
    manifest.migrations = Object.freeze(migrations)
    delete manifest.pages
    delete manifest.settings
  }
  if (klass === 'suite') {
    manifest.supplies = Object.freeze(suite.supplies)
    manifest.entries = Object.freeze({ ...suite.entries })
    manifest.appliesTo = Object.freeze(appliesTo)
    manifest.deps = Object.freeze(suite.deps)
    manifest.overrides = Object.freeze(overrides)
    if (raw.resourceKind !== undefined) manifest.resourceKind = raw.resourceKind
    delete manifest.endpoints
    delete manifest.pages
  }
  if (raw.settingsHint !== undefined) manifest.settingsHint = raw.settingsHint.trim()
  if (raw.settingsJump !== undefined) manifest.settingsJump = raw.settingsJump.trim()
  return { ok: true, errors, warnings, manifest: Object.freeze(manifest), incomplete: !klass }
}
