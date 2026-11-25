function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function missing(id, range, route, reason, extra = {}) {
  return {
    ok: false,
    code: 'CAPABILITY_MISSING',
    message: `能力不可用：${id}@${range.min}`,
    details: {
      capability: id,
      min: range.min,
      maxExclusive: range.maxExclusive,
      ...(route ? { provider: route.provider, version: route.version } : {}),
      reason,
      ...extra
    }
  }
}

export function createCapabilityResolver({ snapshot, implementations = {} } = {}) {
  const resolve = (id, { min = 1, maxExclusive = min + 1 } = {}) => {
    if (!Number.isInteger(min) || min < 1 || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      return { ok: false, code: 'INVALID_ENTRY', message: '能力消费区间必须是正整数且上界大于 min' }
    }
    const range = { min, maxExclusive }
    const route = snapshot?.routes?.[id]
    if (!route) {
      const conflict = snapshot?.issues?.find((item) => item.code === 'CAPABILITY_CONFLICT'
        && (item.details.capability === id || item.details.contribution === id))
      if (conflict) return { ok: false, code: conflict.code, message: conflict.message, details: conflict.details }
      return missing(id, range, null, 'CAPABILITY_NOT_REGISTERED')
    }
    if (route.version < min || route.version >= maxExclusive) return missing(id, range, route, 'CAPABILITY_VERSION_MISMATCH')
    const providerImplementations = implementations[route.provider]
    const implementation = providerImplementations?.[id] ?? providerImplementations
    if (!implementation || typeof implementation !== 'object') return missing(id, range, route, 'CAPABILITY_PROVIDER_UNAVAILABLE')
    const methods = Object.entries(implementation).filter(([, value]) => typeof value === 'function')
    if (!methods.length) return missing(id, range, route, 'CAPABILITY_PROVIDER_EMPTY')
    const capability = {
      id,
      version: route.version,
      provider: route.provider,
      snapshot: snapshot.id,
      ...Object.fromEntries(methods.map(([name, method]) => [name, (...args) => method(...args)]))
    }
    return { ok: true, capability: deepFreeze(capability) }
  }
  return Object.freeze({ snapshot: snapshot?.id ?? '', resolve })
}
