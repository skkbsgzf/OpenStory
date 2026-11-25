import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUiState } from './libState.mjs'
import { BASE_GRAPH } from './baseCapabilities.mjs'
import { buildCapabilitySnapshot, capabilityStartupReport, moduleDegradation, readModuleEnabled } from './capabilityGraph.mjs'
import { HOST_COMPOSITION_IDS, isHostComposition, moduleRole } from './moduleIdentity.mjs'
import { loadShelfCapabilityManifests, readShelfSuiteState } from './shelfManifests.mjs'

import { MODULE_SPEC, validateModuleManifest } from './moduleManifest.mjs'
export { MODULE_SPEC, validateModuleManifest } from './moduleManifest.mjs'

export const MODULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules')

const text = (value) => String(value ?? '')

export { HOST_COMPOSITION_IDS, isHostComposition, moduleRole } from './moduleIdentity.mjs'
export { SLOT_IDS, SLOT_REGISTRY, SLOT_SPEC, isRegisteredSlot, slotEntry, slotPlacements } from './slots.mjs'

export {
  buildCapabilitySnapshot,
  capabilityStartupReport,
  deriveModuleStateChange,
  moduleDegradation,
  readModuleEnabled,
  readSuiteEnabled
} from './capabilityGraph.mjs'

export function loadModuleManifests(dir = MODULES_DIR) {
  const manifests = []
  const sources = []
  const warnings = []
  const notices = []
  if (!existsSync(dir)) return { manifests, sources, warnings, notices }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const manifestPath = join(dir, entry.name, 'module.manifest.json')
    if (!existsSync(manifestPath)) continue
    let rawText = ''
    let raw = null
    try {
      rawText = readFileSync(manifestPath, 'utf-8')
      raw = JSON.parse(rawText)
    } catch (error) {
      warnings.push({ code: 'MODULE_MANIFEST_UNREADABLE', id: entry.name, message: `manifest 读不了：${entry.name}（${text(error?.message || error)}）` })
      continue
    }
    const checked = validateModuleManifest(raw, { dirName: entry.name })
    const sourceMismatch = raw?.builtin === false
    if (!checked.ok || sourceMismatch) {
      const errors = sourceMismatch ? [...checked.errors, '内置目录中的 manifest 不得声明 builtin:false'] : checked.errors
      warnings.push({ code: 'MODULE_MANIFEST_INVALID', id: entry.name, message: `${entry.name}：${errors.join('；')}` })
      continue
    }
    manifests.push(checked.manifest)
    sources.push(Object.freeze({
      id: entry.name,
      source: 'builtin',
      sourceDir: relative(join(MODULES_DIR, '..', '..'), dir).replaceAll('\\', '/') + `/${entry.name}`,
      manifestSha256: createHash('sha256').update(rawText).digest('hex'),
      role: moduleRole(checked.manifest)
    }))
    if (isHostComposition(entry.name)) {
      notices.push({ code: 'MODULE_HOST_COMPOSITION', id: entry.name, message: `${entry.name}：宿主组合面登记，不随工作台启停` })
      continue
    }
    for (const code of checked.warnings) {
      warnings.push({ code, id: entry.name, message: `${entry.name}：${code}` })
    }
  }
  manifests.sort((left, right) => left.id.localeCompare(right.id))
  sources.sort((left, right) => left.id.localeCompare(right.id))
  return { manifests, sources, warnings, notices }
}

export { BASE_CAPABILITIES, BASE_GRAPH, BASE_REQUIRES } from './baseCapabilities.mjs'

const loaded = loadModuleManifests(MODULES_DIR)
export const MODULE_MANIFESTS = Object.freeze(loaded.manifests)
export const MODULE_SOURCES = Object.freeze(loaded.sources)
export const MODULE_MANIFEST_WARNINGS = Object.freeze(loaded.warnings)
export const MODULE_MANIFEST_NOTICES = Object.freeze(loaded.notices)
export const MODULE_SOURCE_GROUPS = Object.freeze(Object.fromEntries(
  ['kernel', 'workbench', 'suite', 'host-composition', 'unclassified'].map((role) => [
    role,
    Object.freeze(MODULE_SOURCES.filter((source) => source.role === role).map((source) => source.id))
  ])
))
/**
 * OS-192：五类货架与工作台/内核件进同一张能力图。
 * 套件清单只从 loadShelfCapabilityManifests() 取；模块装载期的默认目录即可覆盖全部内置货架。
 */
export const SHELF_MANIFESTS = loadShelfCapabilityManifests({
  suitesDirs: [join(MODULES_DIR, '..', '..', 'suites')],
  skillsDirs: [join(MODULES_DIR, '..', '..', 'skills')],
  stylesDirs: [join(MODULES_DIR, '..', '..', 'styles')],
  genresDirs: [join(MODULES_DIR, '..', '..', 'genres')],
  runtimesDirs: [join(MODULES_DIR, '..', '..', 'runtimes')]
})
export const ALL_CAPABILITY_MANIFESTS = Object.freeze([...MODULE_MANIFESTS, ...SHELF_MANIFESTS])
export const CAPABILITY_SNAPSHOT = buildCapabilitySnapshot({
  manifests: ALL_CAPABILITY_MANIFESTS,
  base: BASE_GRAPH,
  suiteState: readShelfSuiteState({}),
  warnings: MODULE_MANIFEST_WARNINGS,
  sources: MODULE_SOURCES
})
export const CAPABILITY_STARTUP_REPORT = capabilityStartupReport(CAPABILITY_SNAPSHOT)
export const MODULE_IDS = Object.freeze(MODULE_MANIFESTS.map((manifest) => manifest.id))

export const MODULE_ENDPOINT_OWNERS = Object.freeze(Object.fromEntries(
  MODULE_MANIFESTS.flatMap((manifest) => (manifest.endpoints ?? []).map((endpoint) => [endpoint, manifest.id]))
))

export function moduleManifest(id) {
  return MODULE_MANIFESTS.find((manifest) => manifest.id === id) ?? null
}

export function moduleSource(id) {
  return MODULE_SOURCES.find((source) => source.id === id) ?? null
}

export function moduleOfEndpoint(endpointId) {
  return MODULE_ENDPOINT_OWNERS[endpointId] ?? null
}

export function moduleStateKey(id) {
  return `modules.enabled.${id}`
}

export async function isModuleEnabled(root, id) {
  if (!root || isHostComposition(id)) return true
  if (!moduleManifest(id)) return true
  try {
    const { state } = await readUiState(root)
    return readModuleEnabled(state ?? {}, id)
  } catch {
    return true
  }
}

export async function isModuleDisabledFor(endpointId, root) {
  const moduleId = moduleOfEndpoint(endpointId)
  if (!moduleId) return null
  return (await isModuleEnabled(root, moduleId)) ? null : moduleId
}

export async function capabilitySnapshotFor(root) {
  if (!root) return CAPABILITY_SNAPSHOT
  try {
    const { state } = await readUiState(root)
    return buildCapabilitySnapshot({
      manifests: ALL_CAPABILITY_MANIFESTS,
      state,
      suiteState: readShelfSuiteState({ root }),
      base: BASE_GRAPH,
      sources: MODULE_SOURCES
    })
  } catch {
    return CAPABILITY_SNAPSHOT
  }
}

export async function moduleDegradationFor(endpointId, root) {
  const moduleId = moduleOfEndpoint(endpointId)
  if (!moduleId || !root || !(await isModuleEnabled(root, moduleId))) return null
  try {
    const snapshot = await capabilitySnapshotFor(root)
    const degraded = moduleDegradation(snapshot, moduleId)
    return degraded ? { ...degraded, endpoint: endpointId } : null
  } catch {
    return null
  }
}
