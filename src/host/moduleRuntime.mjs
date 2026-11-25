/**
 * OS-196 G4/G5：候选快照 → 三检查 → 原子切换；失败门保持当前快照不动。
 *
 * 进程内只有这里的 `layers` Map 持有「当前层」。切换是一次同步赋值——新请求拿新层，
 * 在途请求在 await 前已持有旧 handler/能力句柄，持旧到底；端点与 slot 归属随层回收。
 *
 * 本机模块根只来自机器级信任表（src/host/moduleRoots.mjs）；未登记的根不被枚举。
 */
import { BASE_GRAPH } from '../protocol/baseCapabilities.mjs'
import {
  buildCapabilitySnapshot, moduleDegradation, readModuleEnabled
} from '../protocol/capabilityGraph.mjs'
import { createCapabilityResolver } from '../protocol/capabilityResolver.mjs'
import { courtyardRoot } from '../protocol/courtyard.mjs'
import { readUiState } from '../protocol/libState.mjs'
import { MODULE_IMPLEMENTATIONS } from '../protocol/capabilityImplementations.mjs'
import {
  ALL_CAPABILITY_MANIFESTS, CAPABILITY_SNAPSHOT, MODULE_ENDPOINT_OWNERS, MODULE_MANIFESTS,
  MODULE_MANIFEST_WARNINGS, MODULE_SOURCES
} from '../protocol/modules.mjs'
import { readShelfSuiteState } from '../protocol/shelfManifests.mjs'
import { slotPlacements } from '../protocol/slots.mjs'
import { baseCapabilities } from './baseCapabilities.mjs'
import { HOST_TOOLS } from './hostTools.mjs'
import { activateLocalModule } from './moduleLoader.mjs'
import { readRootsTable, inspectRoot } from './moduleRoots.mjs'

const layers = new Map()
const text = (value) => String(value ?? '')

function envKey(env) {
  return courtyardRoot(env || process.env) || '(no-courtyard)'
}

function builtinLayer(key) {
  return Object.freeze({
    key,
    id: CAPABILITY_SNAPSHOT.id,
    snapshot: CAPABILITY_SNAPSHOT,
    manifests: ALL_CAPABILITY_MANIFESTS,
    sources: MODULE_SOURCES,
    endpointOwners: MODULE_ENDPOINT_OWNERS,
    contributions: Object.freeze({}),
    implementations: Object.freeze({}),
    discovered: Object.freeze([]),
    warnings: MODULE_MANIFEST_WARNINGS,
    report: Object.freeze({ roots: [], localModules: [], warnings: MODULE_MANIFEST_WARNINGS, blocked: null })
  })
}

/** G1：只枚举信任表里显式登记的根。未登记的根即使有模块也不出现在这里。 */
function discover(env) {
  const table = readRootsTable(env)
  const discovered = []
  const warnings = [...table.warnings]
  const seenIds = new Set()
  for (const root of table.roots) {
    const inspected = inspectRoot(root.path, { registeredModules: root.modules })
    for (const warning of inspected.warnings) warnings.push({ ...warning, root: root.path })
    for (const module of inspected.modules) {
      const item = {
        ...module,
        rootPath: root.path,
        registeredAt: root.registeredAt,
        status: module.status,
        gate: module.gate,
        reason: module.reason
      }
      if (item.status === 'ok') {
        if (seenIds.has(item.id)) {
          item.status = 'skipped'
          item.gate = 'trust'
          item.reason = `同 id 模块已由另一个模块根提供：${item.id}`
        } else seenIds.add(item.id)
      }
      discovered.push(item)
    }
  }
  return { table, discovered, warnings }
}

/** 合并层：本机同 id 覆盖内置；sources 为 G2 摘要的真源。 */
function mergeManifests(locals) {
  const byId = new Map(ALL_CAPABILITY_MANIFESTS.map((manifest) => [manifest.id, manifest]))
  const sources = new Map(MODULE_SOURCES.map((source) => [source.id, source]))
  for (const item of locals) {
    byId.set(item.manifest.id, item.manifest)
    sources.set(item.manifest.id, Object.freeze({
      id: item.manifest.id,
      source: 'local',
      sourceDir: item.rootPath,
      manifestSha256: item.manifestSha256,
      contentSha256: item.contentSha256,
      registeredContentSha256: item.registeredContentSha256,
      registeredManifestSha256: item.registeredManifestSha256,
      contentChanged: item.contentChanged,
      role: item.manifest.class ?? 'unclassified'
    }))
  }
  // 顺序＝内置清单原序（模块在前、货架在后）+ 新增本机 id；同 id 就地覆盖，不重排。
  // 顺序进快照 id，重排会让「什么都没变」也被算成换快照。
  const order = ALL_CAPABILITY_MANIFESTS.map((manifest) => manifest.id)
  for (const item of locals) if (!order.includes(item.manifest.id)) order.push(item.manifest.id)
  const manifests = order.map((id) => byId.get(id)).filter(Boolean)
  const sourceOrder = MODULE_SOURCES.map((source) => source.id)
  for (const item of locals) if (!sourceOrder.includes(item.manifest.id)) sourceOrder.push(item.manifest.id)
  const sourceList = sourceOrder.map((id) => sources.get(id)).filter(Boolean)
  return { manifests, sources: sourceList }
}

/**
 * G4 三检查（在候选快照建好后、切换前）：
 *  ① 端点归属唯一（本机同 id 覆盖内置允许；两个不同模块抢同一端点拒绝）；
 *  ② 底座能力路由不动（base.* 的 provider/version 必须与内置快照一致）；
 *  ③ 内置能力路由不丢（除非本机模块显式声明了同名 override）。
 */
function checkCandidate(candidate, localManifests) {
  const owners = new Map(Object.entries(MODULE_ENDPOINT_OWNERS))
  for (const manifest of localManifests) {
    for (const endpoint of manifest.endpoints ?? []) {
      const owner = owners.get(endpoint)
      if (owner && owner !== manifest.id) {
        return { ok: false, gate: 'switch', reason: `端点 ${endpoint} 同时属于 ${owner} 与 ${manifest.id}` }
      }
      owners.set(endpoint, manifest.id)
    }
  }
  for (const [id, route] of Object.entries(CAPABILITY_SNAPSHOT.routes ?? {})) {
    const next = candidate.routes[id]
    if (!next) {
      const overridden = localManifests.some((manifest) => (manifest.overrides ?? [])
        .some((item) => item.type === 'capability' && item.target === id))
      if (!overridden) return { ok: false, gate: 'switch', reason: `内置能力路由 ${id} 在候选快照中丢失` }
      continue
    }
    if (route.provider === 'base' && (next.provider !== 'base' || next.version !== route.version)) {
      return { ok: false, gate: 'switch', reason: `底座能力路由 ${id} 被改动` }
    }
  }
  return { ok: true, owners: Object.fromEntries(owners) }
}

function makeResolver(snapshot, implementations) {
  const all = Object.freeze({ base: baseCapabilities, ...MODULE_IMPLEMENTATIONS, ...implementations })
  return createCapabilityResolver({ snapshot, implementations: all })
}

function dependencyProviderMap(manifests) {
  const providers = new Map()
  for (const manifest of MODULE_MANIFESTS) {
    for (const capability of manifest.capabilities ?? []) providers.set(capability.id, manifest.id)
  }
  for (const manifest of manifests) {
    for (const capability of manifest.capabilities ?? []) providers.set(capability.id, manifest.id)
  }
  for (const name of Object.keys(baseCapabilities)) providers.set(name, 'base')
  return providers
}

function isReady(item, providers, implementations) {
  return (item.requires ?? []).every((id) => {
    const provider = providers.get(id)
    if (!provider) return false
    if (provider === 'base' || MODULE_MANIFESTS.some((manifest) => manifest.id === provider)) return true
    return Boolean(implementations[provider])
  })
}

async function buildLayer(env, key) {
  const { table, discovered, warnings } = discover(env)
  const candidates = discovered.filter((item) => item.status === 'ok')
  // 本机模块不许自称内置：否则会借 builtin 标记绕过覆盖裁决。
  for (const item of candidates.slice()) {
    if (item.selfBuiltin === true) {
      candidates.splice(candidates.indexOf(item), 1)
      const target = discovered.find((entry) => entry === item)
      if (target) Object.assign(target, { status: 'invalid', gate: 'identity', reason: '本机模块不得声明 builtin:true' })
    }
  }
  const localManifests = candidates.map((item) => Object.freeze({ ...item.manifest, builtin: false }))
  const merged = mergeManifests(candidates.map((item, index) => ({ ...item, manifest: localManifests[index] })))
  const providers = dependencyProviderMap(localManifests)
  const layerWarnings = [...MODULE_MANIFEST_WARNINGS, ...warnings]
  const builtinSuiteState = readShelfSuiteState({})
  const preliminary = buildCapabilitySnapshot({
    manifests: merged.manifests, sources: merged.sources, base: BASE_GRAPH,
    suiteState: builtinSuiteState, warnings: layerWarnings
  })
  const implementations = {}
  const activated = []
  const waiting = candidates.slice()
  while (waiting.length) {
    let progressed = false
    for (let index = 0; index < waiting.length; index += 1) {
      const item = waiting[index]
      if (!isReady(item, providers, implementations)) continue
      waiting.splice(index, 1)
      index -= 1
      try {
        const result = await activateLocalModule({
          root: item.rootPath,
          manifest: localManifests[candidates.indexOf(item)],
          snapshot: preliminary,
          resolver: makeResolver(preliminary, implementations),
          contentSha256: item.contentSha256
        })
        activated.push({ item, result })
        if (result.contribution.capabilities) implementations[item.id] = result.contribution.capabilities
        Object.assign(item, { status: 'loaded', gate: '', reason: '' })
        progressed = true
      } catch (error) {
        Object.assign(item, {
          status: 'invalid',
          gate: error?.code === 'CONTRIBUTION_REJECTED' ? 'contribution' : 'activation',
          reason: text(error?.message || error)
        })
        progressed = true
      }
    }
    if (!progressed) {
      for (const item of waiting) Object.assign(item, { status: 'invalid', gate: 'capability', reason: '依赖不可达或成环，跳过装载' })
      break
    }
  }

  const accepted = activated.map(({ item }) => item)
  const finalMerged = mergeManifests(accepted.map((item) => ({ ...item, manifest: localManifests[candidates.indexOf(item)] })))
  const candidate = buildCapabilitySnapshot({
    manifests: finalMerged.manifests,
    sources: finalMerged.sources,
    base: BASE_GRAPH,
    suiteState: builtinSuiteState,
    warnings: layerWarnings
  })
  const checked = checkCandidate(candidate, accepted.map((item) => localManifests[candidates.indexOf(item)]))
  let snapshot = candidate
  let owners = checked.owners ?? MODULE_ENDPOINT_OWNERS
  let blocked = null
  if (!checked.ok) {
    // G5：三检查不过＝当前快照不动；坏的候选只写报告，绝不切进去。
    blocked = { gate: checked.gate, reason: checked.reason }
    for (const item of accepted) Object.assign(item, { status: 'invalid', gate: checked.gate, reason: checked.reason })
    snapshot = CAPABILITY_SNAPSHOT
    owners = MODULE_ENDPOINT_OWNERS
  }
  const contributions = Object.freeze(Object.fromEntries(activated
    .filter(({ item }) => accepted.includes(item))
    .filter(({ item }) => !blocked)
    .map(({ item, result }) => [item.id, result.contribution])))
  const report = Object.freeze({
    roots: Object.freeze(table.roots.map((root) => Object.freeze({
      path: root.path,
      registeredAt: root.registeredAt,
      moduleCount: discovered.filter((item) => item.rootPath === root.path).length,
      modules: Object.freeze(discovered.filter((item) => item.rootPath === root.path).map(summarizeModule))
    }))),
    localModules: Object.freeze(discovered.map(summarizeModule)),
    slotPlacements: slotPlacements(finalMerged.manifests, snapshot.enabled),
    warnings: Object.freeze(warnings),
    blocked
  })
  return Object.freeze({
    key,
    id: snapshot.id,
    snapshot,
    manifests: blocked ? ALL_CAPABILITY_MANIFESTS : finalMerged.manifests,
    sources: blocked ? MODULE_SOURCES : finalMerged.sources,
    endpointOwners: Object.freeze(owners),
    contributions: blocked ? Object.freeze({}) : contributions,
    implementations: blocked ? Object.freeze({}) : Object.freeze({ ...implementations }),
    discovered: Object.freeze(discovered.map(summarizeModule)),
    warnings: Object.freeze(warnings),
    report
  })
}

function summarizeModule(item) {
  return Object.freeze({
    id: item.id,
    name: item.name,
    version: item.version,
    class: item.class,
    source: 'local',
    sourceDir: item.rootPath,
    rootPath: item.rootPath,
    registeredAt: item.registeredAt,
    status: item.status,
    gate: item.gate,
    reason: item.reason,
    manifestSha256: item.manifestSha256,
    contentSha256: item.contentSha256,
    registeredContentSha256: item.registeredContentSha256 ?? '',
    registeredManifestSha256: item.registeredManifestSha256 ?? '',
    contentChanged: Boolean(item.contentChanged),
    manifestChanged: Boolean(item.manifestChanged),
    capabilities: Object.freeze(item.capabilities ?? []),
    requires: Object.freeze(item.requires ?? []),
    supplies: Object.freeze(item.supplies ?? []),
    endpoints: Object.freeze(item.manifest?.endpoints ?? []),
    pages: Object.freeze(item.manifest?.pages ?? []),
    slots: Object.freeze(item.manifest?.slots ?? [])
  })
}

/** 懒初始化：并发请求共享同一份 Promise；失败回内置层，不挡 daemon。 */
export async function ensureRuntime(env = process.env) {
  const key = envKey(env)
  if (!layers.has(key)) {
    const pending = buildLayer(env || process.env, key)
      .then((layer) => { layers.set(key, layer); return layer })
      .catch(() => { const fallback = builtinLayer(key); layers.set(key, fallback); return fallback })
    layers.set(key, pending)
  }
  return layers.get(key)
}

/** 信任表变化后的重建：成功＝原子替换当前层；失败＝保留当前层并回报失败门。 */
export async function rebuildRuntime(env = process.env) {
  const key = envKey(env)
  const previous = layers.get(key)
  try {
    const next = await buildLayer(env || process.env, key)
    layers.set(key, next)
    return { ok: true, id: next.id, report: next.report, previous: previous?.id ?? '' }
  } catch (error) {
    return { ok: false, gate: 'switch', reason: text(error?.message || error) }
  }
}

/** 当前层的汇总报告（/api/plugins 直接取数）。 */
export async function moduleRootsReport(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.report
}

/** 当前层的候选 manifests（已含本机覆盖），按库 ui-state 再建快照。 */
export async function snapshotFor(root, env = process.env) {
  const layer = await ensureRuntime(env)
  if (!root) return layer.snapshot
  try {
    const { state } = await readUiState(root)
    return buildCapabilitySnapshot({
      manifests: layer.manifests,
      sources: layer.sources,
      state,
      suiteState: readShelfSuiteState({ root }),
      base: BASE_GRAPH,
      warnings: layer.warnings
    })
  } catch {
    return layer.snapshot
  }
}

/** 端点归属：本机声明优先，内置层兜底（同 id 覆盖）。 */
export async function endpointOwnerFor(endpointId, env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.endpointOwners[endpointId] ?? null
}

export async function moduleManifestFor(id, env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.manifests.find((manifest) => manifest.id === id) ?? null
}

/** 当前层的全部 manifests（本机同 id 已覆盖内置），供 /api/plugins 如实列出本机层。 */
export async function manifestsFor(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.manifests
}

/** 当前层的 source 记录（manifestSha256／内容摘要／来源），供 /api/plugins 逐项报告。 */
export async function sourcesFor(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.sources
}

/** 本机层贡献的能力实现（与内置实现表合并后给 resolver）。 */
export async function localImplementations(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.implementations
}

export async function localContribution(moduleId, env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.contributions[moduleId] ?? null
}

/** 模块停用闸（本机 id 也按库内 ui-state 判）。 */
export async function moduleDisabledOwnerFor(endpointId, root, env = process.env) {
  const owner = await endpointOwnerFor(endpointId, env)
  if (!owner || !root) return null
  try {
    const { state } = await readUiState(root)
    return readModuleEnabled(state ?? {}, owner) ? null : owner
  } catch {
    return null
  }
}

/** 能力断链闸：报告是哪条能力、哪个消费者缺。 */
export async function degradationFor(endpointId, root, env = process.env) {
  const owner = await endpointOwnerFor(endpointId, env)
  if (!owner || !root) return null
  const snapshot = await snapshotFor(root, env)
  const degraded = moduleDegradation(snapshot, owner)
  return degraded ? { ...degraded, endpoint: endpointId } : null
}

/** slot 归属随快照回收：取当前层的 slot 编排。 */
export async function slotPlacementsFor(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.report.slotPlacements
}

/** 测试钩子：当前进程里缓存了几层（验证切换不重复建层）。 */
export function __runtimeLayers() {
  return layers.size
}
