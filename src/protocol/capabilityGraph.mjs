import { hostCompositionDisablePatch, isHostComposition } from './moduleIdentity.mjs'

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const text = (value) => String(value ?? '')
const list = (value) => Array.isArray(value) ? value : []
const positiveInt = (value) => Number.isInteger(value) && value > 0
const rangeMax = (range) => positiveInt(range?.maxExclusive) ? range.maxExclusive : range.min + 1
const matches = (provider, range) => provider.id === range.id && provider.version >= range.min && provider.version < rangeMax(range)

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function issue(code, message, details) {
  return { code, message, details }
}

function issueSignature(item) {
  return JSON.stringify([item.code, item.details])
}

export function readModuleEnabled(state, id, forceEnabled = []) {
  if (forceEnabled.includes(id) || isHostComposition(id)) return true
  const key = `modules.enabled.${id}`
  if (state && own(state, key)) return state[key] !== false
  const nested = state?.modules?.enabled
  if (nested && typeof nested === 'object' && own(nested, id)) return nested[id] !== false
  return true
}

export function readSuiteEnabled(state, id) {
  const suites = state?.suites
  return !(suites && typeof suites === 'object' && own(suites, id) && suites[id]?.enabled === false)
}

function enabledMap(manifests, state, enabled, forceEnabled, suiteState) {
  const forced = new Set(forceEnabled)
  return Object.fromEntries(manifests.map((manifest) => [
    manifest.id,
    isHostComposition(manifest.id)
      ? true
      : enabled && own(enabled, manifest.id)
        ? enabled[manifest.id] !== false
        : manifest.class === 'suite'
        ? readSuiteEnabled(suiteState, manifest.id)
        : readModuleEnabled(state, manifest.id, [...forced])
  ]))
}

function snapshotId(manifests, enabled, routes, surfaces, issues, digests) {
  const source = JSON.stringify([
    manifests.map((manifest) => [manifest.id, manifest.version, enabled[manifest.id]]),
    Object.entries(routes).map(([id, route]) => [id, route.provider, route.version]),
    surfaces,
    issues.map((item) => [item.code, item.details]),
    // OS-196 G2：同版本改代码＝新快照。摘要入 id，激活缓存也按摘要分键。
    digests
  ])
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `capability-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function findCycleNodes(edges) {
  const colors = new Map()
  const stack = []
  const cyclic = new Set()
  const visit = (id) => {
    colors.set(id, 1)
    stack.push(id)
    for (const edge of edges.get(id) ?? []) {
      const targets = edge.targets ?? [edge]
      for (const target of targets) {
        const provider = target.provider
        if (!colors.has(provider)) {
          visit(provider)
        } else if (colors.get(provider) === 1) {
          const start = stack.indexOf(provider)
          for (const member of stack.slice(start)) cyclic.add(member)
        }
      }
    }
    stack.pop()
    colors.set(id, 2)
  }
  for (const id of edges.keys()) if (!colors.has(id)) visit(id)
  return cyclic
}

function capabilityProviders(manifests, enabled, baseCapabilities) {
  const providers = baseCapabilities.map((capability) => ({
    id: capability.id,
    version: capability.version,
    provider: 'base',
    builtin: true,
    ...(capability.golden !== undefined ? { golden: capability.golden } : {})
  }))
  for (const manifest of manifests) {
    if (!enabled[manifest.id] || manifest.class !== 'kernel') continue
    for (const capability of list(manifest.capabilities)) {
      providers.push({
        id: capability.id,
        version: capability.version,
        provider: manifest.id,
        builtin: manifest.builtin === true,
        ...(capability.golden !== undefined ? { golden: capability.golden } : {})
      })
    }
  }
  return providers
}

function surfaceProviders(manifests, enabled) {
  const contributions = []
  for (const manifest of manifests) {
    if (!enabled[manifest.id]) continue
    if (manifest.class === 'workbench' || manifest.class === undefined) {
      for (const page of list(manifest.pages)) {
        contributions.push({ type: 'surface', id: page.id, provider: manifest.id, version: 1, builtin: manifest.builtin === true })
      }
    }
    if (manifest.class === 'suite' && list(manifest.supplies).includes('resource')) {
      contributions.push({ type: 'resource', id: manifest.id, provider: manifest.id, version: 1, builtin: manifest.builtin === true })
    }
  }
  return contributions
}

function orderedOverrideTargets(targets) {
  const local = targets.filter((target) => !target.builtin)
  const builtin = targets.filter((target) => target.builtin)
  if (local.length > 1 || builtin.length > 1) return { reason: 'OVERRIDE_TARGET_AMBIGUOUS', targets: [] }
  return { reason: '', targets: [...local, ...builtin] }
}

function validateOverrides(manifests, enabled, providers, contributions, allProviders) {
  const edges = new Map()
  const rejectedOwners = new Set()
  const rejected = []
  for (const manifest of manifests) {
    if (!enabled[manifest.id]) continue
    for (const override of list(manifest.overrides)) {
      let reason = ''
      let targets = []
      if (override.type === 'capability') {
        const supplied = list(manifest.capabilities).find((capability) => capability.id === override.target)
        const externalTargets = providers.filter((provider) => provider.id === override.target
          && provider.version === override.from && provider.provider !== manifest.id)
        const externalAnyVersion = providers.some((provider) => provider.id === override.target && provider.provider !== manifest.id)
        // 被覆盖的供给者可能声明在 manifest 里但当前被停用——它不是「在场」目标，
        // 但证明这条覆盖声明原本指向别人，不算自覆盖。
        const declaredExternalTargets = allProviders.filter((provider) => provider.id === override.target
          && provider.version === override.from && provider.provider !== manifest.id)
        const ordered = orderedOverrideTargets(externalTargets)
        reason = ordered.reason
        targets = ordered.targets
        if (!supplied) reason = 'OVERRIDE_TARGET_NOT_SUPPLIED'
        else if (!externalTargets.length) {
          if (declaredExternalTargets.length) {
            // 目标不在场且只剩覆盖者一个供给者：覆盖声明不生效，覆盖者按普通供给者装载。
            continue
          }
          reason = !externalAnyVersion && providers.some((provider) => provider.id === override.target && provider.provider === manifest.id)
            ? 'SELF_OVERRIDE' : 'OVERRIDE_VERSION_MISMATCH'
        } else if (!reason) {
          const target = targets[0]
          if (target.provider === 'base') reason = 'BASE_CAPABILITY_NOT_OVERRIDABLE'
          else if (target.golden !== undefined && (supplied.golden === undefined || supplied.golden === target.golden)) {
            reason = 'OVERRIDE_GOLDEN_REQUIRED'
          } else {
            const majorChanged = supplied.version !== target.version
            const goldenChanged = supplied.golden !== target.golden
            // 同主版本换金样＝改了落盘格式却没升版，直接拒绝且不再要求迁移器。
            if (goldenChanged && !majorChanged) reason = 'GOLDEN_CHANGE_REQUIRES_MAJOR'
            else if (majorChanged && supplied.version !== target.version + 1) reason = 'OVERRIDE_MIGRATION_GAP'
            else if (majorChanged) {
              const migration = list(manifest.migrations).find((item) => item.capability === override.target
                && item.from === target.version && item.to === supplied.version)
              if (!migration) reason = 'OVERRIDE_MIGRATION_REQUIRED'
            }
          }
        }
      } else {
        const externalTargets = contributions.filter((item) => item.type === override.type
          && item.id === override.target && item.provider !== manifest.id)
        const ordered = orderedOverrideTargets(externalTargets)
        reason = ordered.reason
        targets = ordered.targets
        const supplied = contributions.some((item) => item.type === override.type
          && item.id === override.target && item.provider === manifest.id)
        if (override.type === 'surface' && !supplied) reason = 'OVERRIDE_TARGET_NOT_SUPPLIED'
        else if (!externalTargets.length) {
          reason = contributions.some((item) => item.type === override.type
            && item.id === override.target && item.provider === manifest.id) ? 'SELF_OVERRIDE' : 'OVERRIDE_TARGET_MISSING'
        }
      }
      if (reason || !targets.length) {
        rejectedOwners.add(manifest.id)
        rejected.push(issue('OVERRIDE_REJECTED', `${manifest.id} 的覆盖声明不合法`, {
          plugin: manifest.id,
          override: { ...override },
          reason: reason || 'OVERRIDE_TARGET_MISSING'
        }))
        continue
      }
      if (!edges.has(manifest.id)) edges.set(manifest.id, [])
      edges.get(manifest.id).push({ type: override.type, id: override.target, targets })
      for (const target of targets) {
        if (!edges.has(target.provider)) edges.set(target.provider, [])
      }
    }
  }
  const cyclic = findCycleNodes(edges)
  if (cyclic.size) {
    const providers = [...cyclic].sort()
    for (const id of providers) rejectedOwners.add(id)
    rejected.push(issue('CAPABILITY_CONFLICT', `覆盖成环：${providers.join('、')}`, {
      providers,
      reason: 'OVERRIDE_CYCLE'
    }))
  }
  return { edges, rejectedOwners, rejected }
}

function resolveContributions(providers, contributions, edges, blocked, issues) {
  const overridden = new Set()
  for (const [owner, targets] of edges) {
    if (blocked.has(owner)) continue
    for (const target of targets) {
      const available = target.targets.filter((candidate) => !blocked.has(candidate.provider))
      if (!available.length) {
        blocked.add(owner)
        issues.push(issue('OVERRIDE_REJECTED', `${owner} 没有合法回退供给者`, {
          plugin: owner,
          reason: 'OVERRIDE_FALLBACK_UNAVAILABLE'
        }))
        continue
      }
      for (const candidate of available) overridden.add(`${target.type}:${target.id}:${candidate.provider}`)
    }
  }
  const activeProviders = providers.filter((provider) => !blocked.has(provider.provider))
  const activeContributions = contributions.filter((item) => !blocked.has(item.provider))
  const effectiveProviders = activeProviders.filter((provider) => !overridden.has(`capability:${provider.id}:${provider.provider}`))
  const effectiveContributions = activeContributions.filter((item) => !overridden.has(`${item.type}:${item.id}:${item.provider}`))
  const before = blocked.size
  const checkGroup = (items, kind) => {
    const grouped = new Map()
    for (const item of items) {
      if (!grouped.has(item.id)) grouped.set(item.id, [])
      grouped.get(item.id).push(item)
    }
    for (const [id, candidates] of grouped) {
      if (candidates.length < 2) continue
      const providerIds = candidates.map((candidate) => candidate.provider).sort()
      for (const provider of providerIds) blocked.add(provider)
      issues.push(issue('CAPABILITY_CONFLICT', `${id} 有多个未覆盖${kind === 'capability' ? '能力' : '贡献'}`, {
        [kind === 'capability' ? 'capability' : 'contribution']: id,
        type: kind,
        providers: providerIds
      }))
    }
  }
  checkGroup(effectiveProviders, 'capability')
  checkGroup(effectiveContributions.filter((item) => item.type === 'surface'), 'surface')
  checkGroup(effectiveContributions.filter((item) => item.type === 'resource'), 'resource')
  if (blocked.size > before) return resolveContributions(providers, contributions, edges, blocked, issues)
  return { providers: effectiveProviders, contributions: effectiveContributions }
}

function publicRoute(provider) {
  return {
    provider: provider.provider,
    version: provider.version,
    builtin: provider.builtin,
    ...(provider.golden !== undefined ? { golden: provider.golden } : {})
  }
}

export function buildCapabilitySnapshot({
  manifests = [], state = {}, suiteState = {}, enabled, base = {}, forceEnabled = [], warnings = [], sources = []
} = {}) {
  const enabledById = enabledMap(manifests, state, enabled, forceEnabled, suiteState)
  const digests = Object.fromEntries((Array.isArray(sources) ? sources : [])
    .filter((item) => item && item.id)
    .map((item) => [item.id, [
      item.manifestSha256 ?? '',
      item.contentSha256 ?? '',
      item.source ?? '',
      item.registeredContentSha256 ?? ''
    ]])
    .sort(([left], [right]) => left.localeCompare(right)))
  const baseCapabilities = list(base.capabilities)
  const providers = capabilityProviders(manifests, enabledById, baseCapabilities)
  const allProviders = capabilityProviders(manifests, Object.fromEntries(manifests.map((manifest) => [manifest.id, true])), baseCapabilities)
  const contributions = surfaceProviders(manifests, enabledById)
  const issues = []
  const blocked = new Set()
  const dependencyBlocked = new Set()
  const checkedOverrides = validateOverrides(manifests, enabledById, providers, contributions, allProviders)
  issues.push(...checkedOverrides.rejected)
  for (const id of checkedOverrides.rejectedOwners) blocked.add(id)
  let resolved = resolveContributions(providers, contributions, checkedOverrides.edges, blocked, issues)
  let effective = resolved.providers
  let effectiveContributions = resolved.contributions

  const hardMissing = new Map()
  const optionalMissing = []
  const issueSignatures = new Set(issues.map(issueSignature))
  const addIssue = (item) => {
    const signature = issueSignature(item)
    if (issueSignatures.has(signature)) return
    issueSignatures.add(signature)
    issues.push(item)
  }
  const checkRequirement = (consumer, requirement, optional = false) => {
    const supplied = effective.some((provider) => matches(provider, requirement))
    if (supplied) return
    if (optional) {
      optionalMissing.push({ plugin: consumer, capability: requirement.id, min: requirement.min, maxExclusive: rangeMax(requirement) })
      return
    }
    if (!hardMissing.has(consumer)) hardMissing.set(consumer, [])
    hardMissing.get(consumer).push(requirement)
    addIssue(issue('CAPABILITY_MISSING', `${consumer} 缺少 ${requirement.id}@${requirement.min}`, {
      capability: requirement.id,
      consumers: [consumer],
      min: requirement.min,
      maxExclusive: rangeMax(requirement)
    }))
  }
  while (true) {
    for (let index = issues.length - 1; index >= 0; index -= 1) {
      if (issues[index].code === 'CAPABILITY_MISSING') issues.splice(index, 1)
    }
    issueSignatures.clear()
    for (const item of issues) issueSignatures.add(issueSignature(item))
    hardMissing.clear()
    optionalMissing.length = 0
    for (const requirement of list(base.requires)) checkRequirement('base', requirement)
    for (const manifest of manifests) {
      if (!enabledById[manifest.id] || (blocked.has(manifest.id) && !dependencyBlocked.has(manifest.id))) continue
      for (const requirement of list(manifest.requires)) checkRequirement(manifest.id, requirement)
      for (const requirement of list(manifest.optionalRequires)) checkRequirement(manifest.id, requirement, true)
      for (const requirement of list(manifest.appliesTo)) checkRequirement(manifest.id, requirement)
    }
    const contributing = new Set([
      ...providers.map((provider) => provider.provider),
      ...contributions.filter((item) => item.type === 'resource').map((item) => item.provider),
      ...checkedOverrides.edges.keys()
    ])
    const missingProviders = [...hardMissing.keys()].filter((id) => id !== 'base'
      && contributing.has(id) && !blocked.has(id))
    if (!missingProviders.length) break
    for (const id of missingProviders) {
      blocked.add(id)
      dependencyBlocked.add(id)
    }
    resolved = resolveContributions(providers, contributions, checkedOverrides.edges, blocked, issues)
    effective = resolved.providers
    effectiveContributions = resolved.contributions
  }
  const routes = Object.fromEntries(effective.map((provider) => [provider.id, publicRoute(provider)]))
  const issueOrder = { CAPABILITY_MISSING: 0, CAPABILITY_CONFLICT: 1, OVERRIDE_REJECTED: 2 }
  issues.sort((left, right) => issueOrder[left.code] - issueOrder[right.code])

  const optionalByPlugin = new Map()
  for (const item of optionalMissing) {
    if (!optionalByPlugin.has(item.plugin)) optionalByPlugin.set(item.plugin, [])
    optionalByPlugin.get(item.plugin).push(item)
  }
  const statuses = manifests.map((manifest) => {
    if (!enabledById[manifest.id]) return { id: manifest.id, status: 'disabled', active: false, reasons: [] }
    const reasons = []
    if (blocked.has(manifest.id)) reasons.push('CONTRIBUTION_REJECTED')
    if (hardMissing.has(manifest.id)) reasons.push('CAPABILITY_MISSING')
    if (optionalByPlugin.has(manifest.id)) reasons.push('OPTIONAL_CAPABILITY_MISSING')
    const active = reasons.length === 0 || (reasons.length === 1 && reasons[0] === 'OPTIONAL_CAPABILITY_MISSING')
    return { id: manifest.id, status: reasons.length ? 'degraded' : 'loaded', active, reasons }
  })
  const loaded = statuses.filter((item) => item.active).map((item) => item.id)
  const degraded = statuses.filter((item) => item.status === 'degraded').map((item) => item.id)
  const disabled = statuses.filter((item) => item.status === 'disabled').map((item) => item.id)
  const activeSurfaces = effectiveContributions.filter((item) => loaded.includes(item.provider))
  const surfaceRoutes = {}
  for (const item of activeSurfaces) {
    if (!surfaceRoutes[item.id]) surfaceRoutes[item.id] = []
    surfaceRoutes[item.id].push({ type: item.type, provider: item.provider, version: item.version })
  }
  const snapshot = deepFreeze({
    spec: 'openstory-capability-graph@1',
    id: snapshotId(manifests, enabledById, routes, surfaceRoutes, issues, digests),
    ok: issues.length === 0,
    enabled: enabledById,
    loaded,
    degraded,
    disabled,
    statuses,
    routes,
    surfaces: surfaceRoutes,
    issues,
    optionalMissing,
    moduleDigests: digests,
    warnings: list(warnings)
  })
  return snapshot
}

export function capabilityStartupReport(snapshot) {
  return deepFreeze({
    spec: snapshot.spec,
    snapshot: snapshot.id,
    ok: snapshot.ok,
    loaded: snapshot.loaded,
    degraded: snapshot.degraded,
    disabled: snapshot.disabled,
    routes: snapshot.routes,
    issues: snapshot.issues,
    optionalMissing: snapshot.optionalMissing,
    moduleDigests: snapshot.moduleDigests,
    warnings: snapshot.warnings
  })
}

export function moduleDegradation(snapshot, moduleId) {
  const status = snapshot.statuses.find((item) => item.id === moduleId)
  if (!status || status.active || status.status === 'disabled') return null
  return {
    module: moduleId,
    reasons: [...status.reasons],
    missing: missingFor(snapshot, moduleId)
  }
}

function missingFor(snapshot, moduleId) {
  return list(snapshot?.issues)
    .filter((item) => item.code === 'CAPABILITY_MISSING' && list(item.details?.consumers).includes(moduleId))
    .map((item) => ({ capability: item.details.capability, min: item.details.min, maxExclusive: item.details.maxExclusive }))
}

/** 快照状态 → slot 投影所需的 `{status,active,reasons,missing}`（纯函数，handler 只装配）。 */
export function moduleStatusProjection(snapshot = {}) {
  return list(snapshot.statuses).map((item) => ({ ...item, missing: missingFor(snapshot, item.id) }))
}

/**
 * OS-200：治理台的数据面——把一次快照投影成「逐件依赖解析 + 反向依赖 + 降级 + 停用预检」
 * 和一张顶层能力图。纯函数：只读入参，不取文件、不发请求。
 *
 * `manifests` 必须是启用闸看到的同一份有效清单，`state/suiteState/base` 与快照同源；
 * `toggleCheck` 直接调 `deriveModuleStateChange`，与 uiStatePut 的闸逐字同参。
 */
export function projectModuleGraph({
  snapshot = {}, manifests = [], state = {}, suiteState = {}, base = {}
} = {}) {
  // 供给方真源：能力 id → 声明的供给者。路由优先（含本机覆盖），声明兜底（降级时路由会缺条目）。
  const declared = new Map()
  for (const capability of list(base.capabilities)) {
    declared.set(capability.id, {
      provider: 'base', version: capability.version, golden: capability.golden, builtin: true
    })
  }
  for (const manifest of manifests) {
    for (const capability of list(manifest.capabilities)) {
      if (declared.has(capability.id)) continue
      declared.set(capability.id, {
        provider: manifest.id,
        version: capability.version,
        golden: capability.golden,
        builtin: manifest.builtin === true
      })
    }
  }
  const providerOf = (capability) => snapshot?.routes?.[capability]?.provider ?? declared.get(capability)?.provider ?? ''
  const versionOf = (capability) => snapshot?.routes?.[capability]?.version ?? declared.get(capability)?.version ?? 0
  const reasonFor = (capability, requirement, route) => {
    if (!route) {
      const conflict = list(snapshot?.issues).find((item) => item.code === 'CAPABILITY_CONFLICT'
        && (item.details?.capability === capability || item.details?.contribution === capability))
      return conflict ? 'CAPABILITY_CONFLICT' : 'CAPABILITY_NOT_REGISTERED'
    }
    return route.version < requirement.min || route.version >= rangeMax(requirement)
      ? 'CAPABILITY_VERSION_MISMATCH' : ''
  }
  const projectRequirement = (requirement, optional) => {
    const capability = requirement.id
    const route = snapshot?.routes?.[capability]
    const source = declared.get(capability) ?? {}
    const reason = reasonFor(capability, requirement, route)
    return {
      requirement: {
        id: capability,
        min: requirement.min,
        maxExclusive: rangeMax(requirement),
        provider: providerOf(capability),
        version: versionOf(capability),
        ...(source.golden !== undefined ? { golden: source.golden } : {}),
        builtin: source.builtin === true,
        ok: !reason,
        ...(reason ? { reason } : {})
      },
      edge: {
        from: '', to: providerOf(capability), capability,
        min: requirement.min, maxExclusive: rangeMax(requirement), optional
      }
    }
  }

  const edges = []
  const baseConsumers = new Map(list(base.capabilities).map((item) => [item.id, []]))
  const hardByProvider = new Map()
  const requirementsBy = new Map()
  const optionalBy = new Map()
  for (const manifest of manifests) {
    const hard = []
    const optional = []
    for (const requirement of list(manifest.requires)) {
      const { requirement: item, edge } = projectRequirement(requirement, false)
      hard.push(item)
      edges.push({ ...edge, from: manifest.id })
      if (!hardByProvider.has(edge.to)) hardByProvider.set(edge.to, [])
      hardByProvider.get(edge.to).push({ from: manifest.id, capability: edge.capability })
    }
    for (const requirement of list(manifest.optionalRequires)) {
      const { requirement: item, edge } = projectRequirement(requirement, true)
      optional.push(item)
      edges.push({ ...edge, from: manifest.id })
      if (baseConsumers.has(edge.capability)) baseConsumers.get(edge.capability).push(manifest.id)
    }
    for (const item of hard) if (baseConsumers.has(item.id)) baseConsumers.get(item.id).push(manifest.id)
    requirementsBy.set(manifest.id, hard)
    optionalBy.set(manifest.id, optional)
  }

  const statusById = new Map(list(snapshot?.statuses).map((item) => [item.id, item]))
  const optionalMissingBy = new Map()
  for (const item of list(snapshot?.optionalMissing)) {
    if (!optionalMissingBy.has(item.plugin)) optionalMissingBy.set(item.plugin, [])
    optionalMissingBy.get(item.plugin).push({
      capability: item.capability, min: item.min, maxExclusive: item.maxExclusive
    })
  }
  const nameById = new Map(manifests.map((manifest) => [manifest.id, manifest.name]))
  const enabledIds = new Set(manifests.filter((manifest) => snapshot?.enabled?.[manifest.id] !== false).map((manifest) => manifest.id))
  const dependentsBy = new Map()
  for (const [provider, uses] of hardByProvider) {
    const direct = new Map()
    for (const use of uses) {
      if (!direct.has(use.from)) direct.set(use.from, [])
      direct.get(use.from).push(use.capability)
    }
    dependentsBy.set(provider, [...direct].map(([id, capabilities]) => {
      const status = statusById.get(id)
      return {
        id,
        name: nameById.get(id) ?? id,
        enabled: enabledIds.has(id),
        status: status?.status ?? 'loaded',
        capabilities: [...new Set(capabilities)].sort()
      }
    }).sort((left, right) => left.id.localeCompare(right.id)))
  }
  const impactFor = (id, dependents) => {
    const direct = new Set(dependents.map((item) => item.id))
    const seen = new Set([id, ...direct])
    const queue = [...direct]
    const impact = new Set()
    while (queue.length) {
      const current = queue.shift()
      for (const use of hardByProvider.get(current) ?? []) {
        if (seen.has(use.from)) continue
        seen.add(use.from)
        if (enabledIds.has(use.from) && !direct.has(use.from)) impact.add(use.from)
        queue.push(use.from)
      }
    }
    return [...impact].sort()
  }

  const projections = new Map()
  for (const manifest of manifests) {
    const id = manifest.id
    const status = statusById.get(id)
    const dependents = dependentsBy.get(id) ?? []
    const check = deriveModuleStateChange({
      manifests, state, suiteState, base,
      patch: { [`modules.enabled.${id}`]: false }
    })
    projections.set(id, {
      requires: requirementsBy.get(id) ?? [],
      optionalRequires: optionalBy.get(id) ?? [],
      capabilities: list(manifest.capabilities).map((capability) => ({
        id: capability.id,
        version: capability.version,
        ...(capability.golden !== undefined ? { golden: capability.golden } : {})
      })),
      enabled: snapshot?.enabled?.[id] !== false,
      status: status?.status ?? 'loaded',
      statusReasons: [...(status?.reasons ?? [])],
      missing: missingFor(snapshot, id),
      optionalMissing: optionalMissingBy.get(id) ?? [],
      dependents,
      impact: impactFor(id, dependents),
      toggleCheck: check.ok ? { ok: true } : {
        ok: false,
        code: check.code,
        message: check.message,
        ...(list(check.details?.consumers).length ? { consumers: [...check.details.consumers] } : {})
      }
    })
  }
  const moduleGraph = {
    spec: 'openstory-module-graph@1',
    snapshot: snapshot?.id ?? '',
    edges,
    base: [...baseConsumers].map(([id, consumers]) => ({
      id,
      version: declared.get(id)?.version ?? 0,
      consumers: [...new Set(consumers)].sort()
    }))
  }
  return deepFreeze({ projections, moduleGraph })
}

function applyStatePatch(state, patch) {
  const next = { ...state, ...patch }
  for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key]
  return next
}

function applySuiteStatePatch(state, patch) {
  const next = { ...state, ...patch }
  if (patch.suites && typeof patch.suites === 'object') {
    next.suites = { ...state.suites }
    for (const [id, value] of Object.entries(patch.suites)) {
      if (value === null) delete next.suites[id]
      else if (value && typeof value === 'object') next.suites[id] = { ...state.suites?.[id], ...value }
      else next.suites[id] = value
    }
  }
  for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key]
  return next
}

export function deriveModuleStateChange({
  manifests = [], state = {}, patch = {}, suiteState = {}, suitePatch = {}, base = {}, forceEnabled = []
} = {}) {
  const hostDisables = hostCompositionDisablePatch(patch)
  if (hostDisables.length) {
    return {
      ok: false,
      code: 'INVALID_ENTRY',
      message: `宿主组合面不随工作台启停：${hostDisables.join('、')}`,
      details: { modules: hostDisables }
    }
  }
  const current = buildCapabilitySnapshot({ manifests, state, suiteState, base, forceEnabled })
  const candidateState = applyStatePatch(state, patch)
  const candidateSuiteState = applySuiteStatePatch(suiteState, suitePatch)
  const candidate = buildCapabilitySnapshot({ manifests, state: candidateState, suiteState: candidateSuiteState, base, forceEnabled })
  const disabledProviders = manifests.filter((manifest) => current.enabled[manifest.id]
    && !candidate.enabled[manifest.id] && !forceEnabled.includes(manifest.id)).map((manifest) => manifest.id)
  const inUse = new Map()
  for (const item of candidate.issues) {
    if (item.code !== 'CAPABILITY_MISSING' || !disabledProviders.length) continue
    const previous = current.routes[item.details.capability]
    if (!previous || !disabledProviders.includes(previous.provider)) continue
    const consumers = item.details.consumers.filter((consumer) => consumer === 'base' || current.loaded.includes(consumer))
    if (!consumers.length) continue
    if (!inUse.has(previous.provider)) inUse.set(previous.provider, new Set())
    for (const consumer of consumers) inUse.get(previous.provider).add(consumer)
  }
  if (inUse.size) {
    const providers = [...inUse].map(([provider, consumers]) => ({ provider, consumers: [...consumers].sort() }))
    return {
      ok: false,
      code: 'CAPABILITY_IN_USE',
      message: `能力仍被活跃消费者使用：${providers.map((item) => item.provider).join('、')}`,
      details: { providers, provider: providers[0].provider, consumers: providers[0].consumers },
      current,
      candidate
    }
  }
  const currentIssues = new Set(current.issues.map(issueSignature))
  const introduced = candidate.issues.find((item) => {
    if (currentIssues.has(issueSignature(item))) return false
    if (item.code !== 'CAPABILITY_MISSING') return true
    return item.details.consumers.some((consumer) => consumer === 'base' || current.loaded.includes(consumer))
  })
  if (introduced) {
    return {
      ok: false,
      code: introduced.code,
      message: introduced.message,
      details: introduced.details,
      current,
      candidate
    }
  }
  return { ok: true, state: candidateState, suiteState: candidateSuiteState, current, candidate }
}
