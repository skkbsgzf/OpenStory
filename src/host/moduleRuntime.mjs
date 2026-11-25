/**
 * OS-196 G4/G5：候选快照 → 三检查 → 原子切换；失败门保持当前快照不动。
 *
 * 进程内只有这里的 `layers` Map 持有「当前层」。切换是一次同步赋值——新请求拿新层，
 * 在途请求在 await 前已持有旧 handler/能力句柄，持旧到底；端点与 slot 归属随层回收。
 *
 * 本机模块根只来自机器级信任表（src/host/moduleRoots.mjs）；未登记的根不被枚举。
 */
import { ENDPOINTS } from '../api/contracts.mjs'
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
import { MODULE_BOUNDARY_VIOLATION, boundaryHooksStatus, syncModuleBoundaryRoots } from './moduleBoundaryHooks.mjs'
import { activateLocalModule } from './moduleLoader.mjs'
import { prepareLibraryMigrations } from './libraryMigrations.mjs'
import { readRootsTable, inspectRoot } from './moduleRoots.mjs'

const layers = new Map()
const text = (value) => String(value ?? '')

/** 宿主自有端点＝静态契约表减去内置模块独占端点；本机模块谁都不许认领。 */
const HOST_ENDPOINT_IDS = new Set(Object.keys(ENDPOINTS).filter((id) => !MODULE_ENDPOINT_OWNERS[id]))

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
    runtimeContracts: Object.freeze({}),
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
 * OS-196a 端点归属判定点：本机模块只能
 *   (a) 注册自己的新端点（静态契约表与内置模块都没声明过），或
 *   (b) 按 id 覆盖某个内置模块时接管那个模块的端点。
 * 宿主自有端点（uiStatePut 等）谁都不能认领；别人的端点也不能抢；两个本机模块
 * 抢同一个新端点＝两个都淘汰。全部在 manifest 层判，不跑任何 activate。
 */
export function checkEndpointOwnership(manifests = []) {
  const owners = new Map(Object.entries(MODULE_ENDPOINT_OWNERS))
  const claims = new Map()
  for (const manifest of manifests) {
    for (const endpoint of manifest?.endpoints ?? []) {
      if (!claims.has(endpoint)) claims.set(endpoint, [])
      claims.get(endpoint).push(manifest.id)
    }
  }
  const rejected = new Map()
  const reject = (id, reason) => {
    const previous = rejected.get(id)
    rejected.set(id, previous ? `${previous}；${reason}` : reason)
  }
  for (const [endpoint, ids] of claims) {
    const builtinOwner = MODULE_ENDPOINT_OWNERS[endpoint]
    if (HOST_ENDPOINT_IDS.has(endpoint)) {
      for (const id of ids) reject(id, `端点 ${endpoint} 是宿主自有端点，${id} 不得接管`)
      owners.delete(endpoint)
      continue
    }
    if (builtinOwner) {
      for (const id of ids) {
        if (id !== builtinOwner) {
          reject(id, `端点 ${endpoint} 归内置模块 ${builtinOwner}，${id} 只能按 id 覆盖 ${builtinOwner} 才能接管`)
        }
      }
      owners.set(endpoint, builtinOwner)
      continue
    }
    if (ids.length > 1) {
      for (const id of ids) reject(id, `端点 ${endpoint} 被 ${ids.join(' 与 ')} 同时声明，冲突双方都不装载`)
      owners.delete(endpoint)
      continue
    }
    owners.set(endpoint, ids[0])
  }
  return { rejected, owners }
}

/** 三检查的另两项：底座能力路由不动、内置能力路由不丢（manifest 层即可判）。 */
function checkCapabilityRoutes(candidate, localManifests = []) {
  for (const [id, route] of Object.entries(CAPABILITY_SNAPSHOT.routes ?? {})) {
    const next = candidate?.routes?.[id]
    if (!next) {
      const overridden = localManifests.some((manifest) => (manifest.overrides ?? [])
        .some((item) => item.type === 'capability' && item.target === id))
      if (!overridden) return { ok: false, gate: 'switch', reason: `内置能力路由 ${id} 在候选快照中丢失` }
      continue
    }
    if (route.provider === 'base' && (next.provider !== 'base' || next.version !== route.version)) {
      const offenders = localManifests
        .filter((manifest) => (manifest.capabilities ?? []).some((capability) => capability.id === id))
        .map((manifest) => manifest.id)
      return { ok: false, gate: 'switch', reason: `底座能力路由 ${id} 被改动`, offenders }
    }
  }
  return { ok: true }
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
  // G3 运行期钩子认的根＝当前信任表；拆根后同步收回，不走第二套登记。
  syncModuleBoundaryRoots(table.roots.map((root) => root.path))
  const candidates = discovered.filter((item) => item.status === 'ok')
  // 本机模块不许自称内置：否则会借 builtin 标记绕过覆盖裁决。
  for (const item of candidates.slice()) {
    if (item.selfBuiltin === true) {
      candidates.splice(candidates.indexOf(item), 1)
      const target = discovered.find((entry) => entry === item)
      if (target) Object.assign(target, { status: 'invalid', gate: 'identity', reason: '本机模块不得声明 builtin:true' })
    }
  }
  const manifestOf = new Map(candidates.map((item) => [item.id, Object.freeze({ ...item.manifest, builtin: false })]))
  const localOf = (items) => items.map((item) => manifestOf.get(item.id))
  const layerWarnings = [...MODULE_MANIFEST_WARNINGS, ...warnings]
  const builtinSuiteState = readShelfSuiteState({})
  const drop = (item, gate, reason) => Object.assign(item, { status: 'invalid', gate, reason })
  const snapshotForItems = (items) => {
    const merged = mergeManifests(items.map((item) => ({ ...item, manifest: manifestOf.get(item.id) })))
    return {
      merged,
      snapshot: buildCapabilitySnapshot({
        manifests: merged.manifests, sources: merged.sources, base: BASE_GRAPH,
        suiteState: builtinSuiteState, warnings: layerWarnings
      })
    }
  }

  // ① 端点归属：manifest 层先判，违规模块直接淘汰——activate() 一行都不会跑。
  let owners = new Map(Object.entries(MODULE_ENDPOINT_OWNERS))
  let waiting = candidates.slice()
  const applyOwnership = () => {
    const checked = checkEndpointOwnership(localOf(waiting))
    for (const [id, reason] of checked.rejected) {
      const item = waiting.find((entry) => entry.id === id)
      if (!item) continue
      drop(item, 'switch', reason)
      waiting.splice(waiting.indexOf(item), 1)
    }
    owners = checked.owners
    return checked
  }
  applyOwnership()

  // ② 三检查另两项（底座路由不动／内置路由不丢）也在激活前判。
  let probe = snapshotForItems(waiting)
  const route = checkCapabilityRoutes(probe.snapshot, localOf(waiting))
  let blocked = null
  if (!route.ok) {
    const offenders = (route.offenders ?? []).filter((id) => waiting.some((item) => item.id === id))
    if (!offenders.length) {
      // 归因不到具体模块：整层不动，绝不带着坏候选切换。
      blocked = { gate: route.gate, reason: route.reason }
    } else {
      for (const id of offenders) {
        const item = waiting.find((entry) => entry.id === id)
        if (!item) continue
        drop(item, 'switch', route.reason)
        waiting.splice(waiting.indexOf(item), 1)
      }
      applyOwnership()
      probe = snapshotForItems(waiting)
    }
  }

  // ③ 只激活过了检查的模块；依赖未就绪的按图推进，贡献失败按模块淘汰。
  const implementations = {}
  const activated = []
  const pending = blocked ? [] : waiting.slice()
  const providers = dependencyProviderMap(localOf(pending))
  while (pending.length) {
    let progressed = false
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index]
      if (!isReady(item, providers, implementations)) continue
      pending.splice(index, 1)
      index -= 1
      try {
        const result = await activateLocalModule({
          root: item.rootPath,
          manifest: manifestOf.get(item.id),
          snapshot: probe.snapshot,
          resolver: makeResolver(probe.snapshot, implementations),
          contentSha256: item.contentSha256
        })
        activated.push({ item, result })
        if (result.contribution.capabilities) implementations[item.id] = result.contribution.capabilities
        Object.assign(item, { status: 'loaded', gate: '', reason: '' })
        progressed = true
      } catch (error) {
        drop(item,
          error?.code === 'CONTRIBUTION_REJECTED' ? 'contribution'
            : error?.code === MODULE_BOUNDARY_VIOLATION ? 'boundary' : 'activation',
          text(error?.message || error))
        progressed = true
      }
    }
    if (!progressed) {
      for (const item of pending) drop(item, 'capability', '依赖不可达或成环，跳过装载')
      break
    }
  }

  // ④ 激活淘汰了模块＝候选变了：重做归属与三检查，全部通过才原子切换。
  let active = activated.filter(({ item }) => item.status === 'loaded').map(({ item }) => item)
  if (active.length !== waiting.length) {
    for (const [id, reason] of checkEndpointOwnership(localOf(active)).rejected) {
      const item = active.find((entry) => entry.id === id)
      if (item) drop(item, 'switch', reason)
    }
    active = active.filter((item) => item.status === 'loaded')
  }
  probe = snapshotForItems(active)
  const recheck = checkCapabilityRoutes(probe.snapshot, localOf(active))
  if (!recheck.ok) {
    blocked = { gate: recheck.gate, reason: recheck.reason }
    for (const item of active) drop(item, 'switch', recheck.reason)
    active = []
  }
  if (blocked) {
    owners = new Map(Object.entries(MODULE_ENDPOINT_OWNERS))
    probe = { merged: { manifests: ALL_CAPABILITY_MANIFESTS, sources: MODULE_SOURCES }, snapshot: CAPABILITY_SNAPSHOT }
  } else {
    owners = checkEndpointOwnership(localOf(active)).owners
  }
  const snapshot = probe.snapshot
  const kept = new Set(active.map((item) => item.id))
  const contributions = Object.freeze(Object.fromEntries(activated
    .filter(({ item }) => kept.has(item.id))
    .map(({ item, result }) => [item.id, result.contribution])))
  // 运行期自带契约进当前层；停用随快照回收（handlerFor 已按 snapshot.enabled 判）。
  const runtimeContracts = Object.freeze(Object.fromEntries(activated
    .filter(({ item }) => kept.has(item.id))
    .flatMap(({ result }) => Object.entries(result.contribution.contracts ?? {}))))
  const boundary = boundaryHooksStatus()
  // 有登记根才谈得上边界门：空信任表时钩子本就没装（也没有要拦的东西），
  // 报「当前 Node 不支持」是假警报。只在「有根却没装上」或「Node 不支持」时提示。
  const boundaryNeeded = table.roots.length > 0
  const extraWarnings = (boundary.available || !boundaryNeeded)
    ? []
    : [boundary.supported
      ? {
          code: 'MODULE_BOUNDARY_HOOKS_UNAVAILABLE',
          message: `解析钩子没装上（${boundary.reason || '未知原因'}）：边界只做静态提示；依赖文件已变时需重启 daemon 才生效`
        }
      : {
          code: 'MODULE_BOUNDARY_HOOKS_UNSUPPORTED',
          message: `当前 Node（${process.versions.node}）没有 module.registerHooks：边界只做静态提示；需 Node ≥ 22.15`
        }]
  const allWarnings = Object.freeze([...warnings, ...extraWarnings])
  const report = Object.freeze({
    roots: Object.freeze(table.roots.map((root) => Object.freeze({
      path: root.path,
      registeredAt: root.registeredAt,
      moduleCount: discovered.filter((item) => item.rootPath === root.path).length,
      modules: Object.freeze(discovered.filter((item) => item.rootPath === root.path).map(summarizeModule))
    }))),
    localModules: Object.freeze(discovered.map(summarizeModule)),
    rejections: Object.freeze(discovered
      .filter((item) => item.status === 'invalid')
      .map((item) => Object.freeze({ id: item.id, gate: item.gate, reason: item.reason }))),
    slotPlacements: slotPlacements(probe.merged.manifests, snapshot.enabled),
    warnings: allWarnings,
    boundaryHooks: Object.freeze(boundary),
    blocked
  })
  return Object.freeze({
    key,
    id: snapshot.id,
    snapshot,
    manifests: blocked ? ALL_CAPABILITY_MANIFESTS : probe.merged.manifests,
    sources: blocked ? MODULE_SOURCES : probe.merged.sources,
    endpointOwners: Object.freeze(Object.fromEntries(owners)),
    contributions,
    runtimeContracts,
    implementations: blocked ? Object.freeze({}) : Object.freeze({ ...implementations }),
    discovered: Object.freeze(discovered.map(summarizeModule)),
    warnings: allWarnings,
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
    // 失败门：全局检查不过＝当前层不动；坏的候选只写报告，绝不切进去。
    if (next.report?.blocked) {
      return { ok: false, ...next.report.blocked, report: next.report, previous: previous?.id ?? '' }
    }
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

/** OS-197：迁移失败（或回退保护）的覆盖者从该库的有效清单里剔除；同 id 回落到内置件。 */
function effectiveManifests(layer, excluded = []) {
  const drop = new Set(excluded)
  if (!drop.size) return { manifests: layer.manifests, sources: layer.sources }
  const manifests = []
  const sources = []
  for (const manifest of layer.manifests) {
    if (!drop.has(manifest.id)) {
      manifests.push(manifest)
      const source = layer.sources.find((item) => item.id === manifest.id)
      if (source) sources.push(source)
      continue
    }
    const builtin = ALL_CAPABILITY_MANIFESTS.find((item) => item.id === manifest.id)
    if (!builtin) continue
    manifests.push(builtin)
    const source = MODULE_SOURCES.find((item) => item.id === manifest.id)
    if (source) sources.push(source)
  }
  return { manifests, sources }
}

/** 当前层的候选 manifests（已含本机覆盖），按库 ui-state 再建快照。 */
export async function snapshotFor(root, env = process.env) {
  const layer = await ensureRuntime(env)
  if (!root) return layer.snapshot
  try {
    const migrations = await prepareLibraryMigrations(root, layer)
    const effective = effectiveManifests(layer, migrations.excluded)
    const { state } = await readUiState(root)
    return buildCapabilitySnapshot({
      manifests: effective.manifests,
      sources: effective.sources,
      state,
      suiteState: readShelfSuiteState({ root }),
      base: BASE_GRAPH,
      warnings: layer.warnings
    })
  } catch {
    return layer.snapshot
  }
}

/** OS-197：迁移执行状态（真实链路唯一取数口，/api/plugins 与 daemon 闸共用）。 */
export async function migrationStateFor(root, env = process.env) {
  if (!root) return { ok: true, ran: [], skipped: [], failures: [], excluded: [], migrations: [], dataVersions: [], fresh: false }
  const layer = await ensureRuntime(env)
  return prepareLibraryMigrations(root, layer)
}

/** 该库当前快照下有效的 manifests（已剔除迁移失败覆盖者，同 id 回落内置）。 */
export async function effectiveManifestsFor(root, env = process.env) {
  const layer = await ensureRuntime(env)
  if (!root) return layer.manifests
  const migrations = await prepareLibraryMigrations(root, layer)
  return effectiveManifests(layer, migrations.excluded).manifests
}

/** OS-197 回退保护：数据已是 N+1 格式、路由却落在旧供给者时，拒绝静默误读。 */
export async function dataVersionAheadFor(endpointId, root, env = process.env) {
  if (!root) return null
  const [owner, snapshot, manifests, state] = await Promise.all([
    endpointOwnerFor(endpointId, env),
    snapshotFor(root, env),
    effectiveManifestsFor(root, env),
    migrationStateFor(root, env)
  ])
  if (!owner || !state?.dataVersions?.length) return null
  const manifest = manifests.find((item) => item.id === owner)
  if (!manifest) return null
  const required = new Set((manifest.requires ?? []).map((item) => item.id))
  const hits = []
  for (const data of state.dataVersions) {
    const route = snapshot.routes?.[data.capability]
    if (!route || route.version >= data.to) continue
    if (route.provider !== owner && !required.has(data.capability)) continue
    hits.push({
      capability: data.capability,
      dataVersion: data.to,
      provider: route.provider,
      providerVersion: route.version,
      journalPath: data.journalPath
    })
  }
  if (!hits.length) return null
  const first = hits[0]
  return {
    code: 'DATA_VERSION_AHEAD',
    module: owner,
    capability: first.capability,
    dataVersion: first.dataVersion,
    provider: first.provider,
    providerVersion: first.providerVersion,
    journalPath: first.journalPath,
    capabilities: hits,
    message: `库数据已是 ${first.capability}@${first.dataVersion} 格式，当前供给者 ${first.provider}@${first.providerVersion} 会误读：请重新启用覆盖者，或执行回退迁移（不自动执行）`
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

/** 当前层的全部本机贡献（钩子合并与运行期契约取数共用一张表）。 */
export async function localContributions(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.contributions
}

/** 本机模块自带端点契约（runtimeContracts.mjs 与静态表合并的唯一取数口）。 */
export async function runtimeContractsFor(env = process.env) {
  const layer = await ensureRuntime(env)
  return layer.runtimeContracts ?? Object.freeze({})
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
