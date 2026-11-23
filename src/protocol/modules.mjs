/**
 * 工作面模块插件（OS-144 / G5a）——manifest 声明、端点归属、停用语义的唯一真源。
 *
 * 与业务套件（`openstory-suite@2`，src/services/suites.mjs）同构但不是一回事：
 *   · 套件＝「写作规则/设置」的非常驻插件，停用＝规则退回默认；
 *   · 模块＝「工作面」本身（分析 / 生图识图 / 知识库），停用＝入口消失、独占端点回
 *     MODULE_DISABLED，但**值与数据保留**，重新启用即恢复。
 *
 * 目录形状（src/modules/<id>/module.manifest.json，OS-140 六目录宪法）：
 *   { spec:'openstory-module@1', id, name, version, core:false, endpoints:[…], pages:[…], settings:[…],
 *     settingsHint?, settingsJump? }
 *   · endpoints 列的是**该模块独占**的端点 id——多方共用的端点（如 fact 读端点）不登记，
 *     停用某个模块绝不能让共用端点失效；
 *   · pages/settings 是前端入口声明（页面自己用 ui-state 判定显隐，本文件是数据底）。
 *   · settingsHint/settingsJump（OS-146）：模块的**真配置不在设置页**时用来指路——
 *     hint 是一句「真配置在…」，jump 是设置页的目标区块 id（如 engines）。只指路，
 *     不在设置页摆第二份输入框（没有消费者的设置项一律不留）。
 *
 * 启停状态复用库内 ui-state 通道（`.pinax/ui-state.json`）：
 *   `modules.enabled.<id>`（缺省 true；兼容扁平键写法）。停用只写这一个开关，
 *   不删任何稿件/配置；重新启用读到的还是原值。
 *
 * 唯一判定入口＝`isModuleEnabled(root, id)`。daemon 路由、MCP 工具、扮演 AI 味闸
 * 一律调它（或包了它的 `isModuleDisabledFor`），不许各自读文件另写一套。
 *
 * 两层插拔互不覆盖（OS-144 第 4 条）：
 *   · 卡片级：右栏分析面板里每个分析模块的勾选（ui-state `analyzeEnabled`，旧机制）；
 *   · 整模块级：本文件管的 `modules.enabled.<id>`。
 *   整模块停用＝入口整个不出现；重新启用后卡片级勾选原样回来（两层各存各的键）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUiState } from './libState.mjs'

export const MODULE_SPEC = 'openstory-module@1'
const MODULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules')
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/u
const VERSION_RE = /^\d+\.\d+\.\d+$/u
/** OS-145：settings 字段口径与业务套件一致（key 允许点号分段，如 image.comfyUrl）。 */
const SETTING_KEY_RE = /^[\w.]{1,40}$/u
const SETTING_TYPES = new Set(['string', 'number', 'boolean', 'select'])

/** ui-state 里的启停键（扁平写法；嵌套写法 `{ modules: { enabled } }` 也认）。 */
export function moduleStateKey(id) {
  return `modules.enabled.${id}`
}

function text(value) {
  return String(value ?? '')
}

/**
 * manifest 形状校验（纯函数，测试与装载共用）。
 * @returns {{ ok:boolean, errors:string[], manifest?:object }}
 */
export function validateModuleManifest(raw, { dirName = '' } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest 必须是对象'] }
  }
  if (text(raw.spec) !== MODULE_SPEC) errors.push(`spec 必须是 ${MODULE_SPEC}`)
  const id = text(raw.id).trim()
  if (!ID_RE.test(id)) errors.push('id 非法（小写字母开头，只许 a-z 0-9 -，≤40 字）')
  if (dirName && id !== dirName) errors.push(`id（${id}）必须与目录名（${dirName}）一致`)
  if (!text(raw.name).trim()) errors.push('缺 name')
  if (!VERSION_RE.test(text(raw.version).trim())) errors.push('version 必须是三段数字（如 0.1.0）')
  if (typeof raw.core !== 'boolean') errors.push('core 必须是布尔值（本批三个模块都是 false）')
  const endpoints = raw.endpoints
  if (!Array.isArray(endpoints)) {
    errors.push('endpoints 必须是数组')
  } else {
    const seen = new Set()
    for (const endpoint of endpoints) {
      const value = text(endpoint).trim()
      if (!value) { errors.push('endpoints 里有空项'); continue }
      if (seen.has(value)) { errors.push(`endpoints 重复：${value}`); continue }
      seen.add(value)
    }
  }
  for (const key of ['pages', 'settings']) {
    const list = raw[key]
    if (!Array.isArray(list)) { errors.push(`${key} 必须是数组`); continue }
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) errors.push(`${key}[${index}] 必须是对象`)
      else if (!text(item.id ?? item.key).trim()) errors.push(`${key}[${index}] 缺 id/key`)
    })
  }
  // OS-145：settings 升级为可渲染声明，字段口径对齐业务套件（openstory-suite@2）：
  // { key, label, type:'string'|'number'|'boolean'|'select', default?, options? }。
  // 值落库内 ui-state（modules.settings.<id>.<key>），不看这里的 default 是否等于现值。
  if (Array.isArray(raw.settings)) {
    raw.settings.forEach((setting, index) => {
      if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return
      const settingKey = text(setting.key ?? setting.id).trim()
      if (settingKey && !SETTING_KEY_RE.test(settingKey)) { errors.push(`settings[${index}] key 非法：${settingKey}`); return }
      const type = text(setting.type).trim()
      if (!SETTING_TYPES.has(type)) { errors.push(`settings[${index}]（${settingKey}）type 非法（string/number/boolean/select）`); return }
      if (!text(setting.label).trim()) errors.push(`settings[${index}]（${settingKey}）缺 label`)
      if (type === 'select') {
        const options = Array.isArray(setting.options) ? setting.options.map((option) => text(option)) : []
        if (options.length === 0) errors.push(`settings[${index}]（${settingKey}）select 缺 options`)
        else if (setting.default !== undefined && !options.includes(text(setting.default))) {
          errors.push(`settings[${index}]（${settingKey}）的 default 不在 options 里`)
        }
      }
      if (type === 'boolean' && setting.default !== undefined && typeof setting.default !== 'boolean') {
        errors.push(`settings[${index}]（${settingKey}）boolean 的 default 必须是布尔值`)
      }
      if (type === 'number' && setting.default !== undefined && !Number.isFinite(setting.default)) {
        errors.push(`settings[${index}]（${settingKey}）number 的 default 必须是数字`)
      }
      if (type === 'string' && setting.default !== undefined && typeof setting.default !== 'string') {
        errors.push(`settings[${index}]（${settingKey}）string 的 default 必须是字符串`)
      }
    })
  }
  if (errors.length) return { ok: false, errors }
  // OS-146：可选的指路字段（真配置在别处时用）。给了就必须是非空字符串——空串等于没写。
  if (raw.settingsHint !== undefined && (typeof raw.settingsHint !== 'string' || !raw.settingsHint.trim())) {
    errors.push('settingsHint 给了就必须是非空字符串')
  }
  if (raw.settingsJump !== undefined && (typeof raw.settingsJump !== 'string' || !raw.settingsJump.trim())) {
    errors.push('settingsJump 给了就必须是非空字符串（设置页区块 id）')
  }
  if (errors.length) return { ok: false, errors }
  const manifest = {
    spec: MODULE_SPEC,
    id,
    name: text(raw.name).trim(),
    version: text(raw.version).trim(),
    core: raw.core,
    description: text(raw.description).trim(),
    endpoints: Object.freeze(raw.endpoints.map((endpoint) => text(endpoint).trim())),
    pages: Object.freeze(raw.pages.map((page) => Object.freeze({ ...page, id: text(page.id ?? page.key).trim() }))),
    settings: Object.freeze(raw.settings.map((setting) => Object.freeze({ ...setting, key: text(setting.key ?? setting.id).trim() })))
  }
  // 没写就不带这两个键（校验结果本身也要能再喂回校验——空串会被当成「给了但空」）
  if (raw.settingsHint !== undefined) manifest.settingsHint = raw.settingsHint.trim()
  if (raw.settingsJump !== undefined) manifest.settingsJump = raw.settingsJump.trim()
  return { ok: true, errors, manifest: Object.freeze(manifest) }
}

/** 扫描 src/modules/<id>/module.manifest.json（无 manifest 的目录＝普通模块，静默跳过）。 */
export function loadModuleManifests(dir = MODULES_DIR) {
  const manifests = []
  const warnings = []
  if (!existsSync(dir)) return { manifests, warnings }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const manifestPath = join(dir, entry.name, 'module.manifest.json')
    if (!existsSync(manifestPath)) continue
    let raw = null
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      warnings.push({ code: 'MODULE_MANIFEST_UNREADABLE', id: entry.name, message: `manifest 读不了：${entry.name}（${text(error?.message || error)}）` })
      continue
    }
    const checked = validateModuleManifest(raw, { dirName: entry.name })
    if (!checked.ok) {
      warnings.push({ code: 'MODULE_MANIFEST_INVALID', id: entry.name, message: `${entry.name}：${checked.errors.join('；')}` })
      continue
    }
    manifests.push(checked.manifest)
  }
  manifests.sort((left, right) => left.id.localeCompare(right.id))
  return { manifests, warnings }
}

const loaded = loadModuleManifests()
/** 全部模块 manifest（只读）。 */
export const MODULE_MANIFESTS = Object.freeze(loaded.manifests)
export const MODULE_MANIFEST_WARNINGS = Object.freeze(loaded.warnings)
export const MODULE_IDS = Object.freeze(MODULE_MANIFESTS.map((manifest) => manifest.id))

/** endpointId → 独占它的模块 id。共用端点不登记，因此不在这张表里。 */
export const MODULE_ENDPOINT_OWNERS = Object.freeze(Object.fromEntries(
  MODULE_MANIFESTS.flatMap((manifest) => manifest.endpoints.map((endpoint) => [endpoint, manifest.id]))
))

export function moduleManifest(id) {
  return MODULE_MANIFESTS.find((manifest) => manifest.id === id) ?? null
}

/** 端点归属：没有任何模块独占＝null（共用端点，停用任何模块都不受影响）。 */
export function moduleOfEndpoint(endpointId) {
  return MODULE_ENDPOINT_OWNERS[endpointId] ?? null
}

function rawEnabled(state, id) {
  const key = moduleStateKey(id)
  if (state && Object.prototype.hasOwnProperty.call(state, key)) return state[key]
  const nested = state?.modules?.enabled
  if (nested && typeof nested === 'object' && Object.prototype.hasOwnProperty.call(nested, id)) return nested[id]
  return undefined
}

/**
 * 启停判定的**唯一入口**：模块是否启用（缺省 true）。
 * 没有库根（库清单页 / 未授权 root）时按启用处理——停用状态是库内概念。
 */
export async function isModuleEnabled(root, id) {
  if (!root) return true
  if (!moduleManifest(id)) return true // 未知 id 不是插件，不拦
  try {
    const { state } = await readUiState(root)
    return rawEnabled(state ?? {}, id) !== false
  } catch {
    return true // 读不到状态≠停用（坏档不阻断工作面）
  }
}

/**
 * 端点级闸：该端点被某模块独占且该模块在 root 下停用 → 返回模块 id，否则 null。
 * 共用端点（未登记归属）永远返回 null。
 */
export async function isModuleDisabledFor(endpointId, root) {
  const moduleId = moduleOfEndpoint(endpointId)
  if (!moduleId) return null
  return (await isModuleEnabled(root, moduleId)) ? null : moduleId
}
