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

export function createCapabilityResolver({ snapshot, implementations = {}, dataVersions = [] } = {}) {
  // OS-197a 回退保护下沉：按库已落盘的数据版本先建一张「能力→最高已迁档位」表。
  // 供给者自己拒绝旧句柄，模块端点、宿主端点、钩子与 MCP 直连走同一道判定。
  const ahead = new Map()
  for (const item of (Array.isArray(dataVersions) ? dataVersions : [])) {
    if (!item || typeof item !== 'object') continue
    const capability = String(item.capability ?? '')
    const version = item.to
    if (!capability || !Number.isInteger(version)) continue
    const previous = ahead.get(capability)
    if (!previous || version > previous.version) {
      ahead.set(capability, { version, journalPath: String(item.journalPath ?? '') })
    }
  }
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
    // 数据已升档而路由落在旧供给者：这里就不发句柄，不等 HTTP 端点闸来兜。
    const dataAhead = ahead.get(id)
    if (dataAhead && route.version < dataAhead.version) {
      return {
        ok: false,
        code: 'DATA_VERSION_AHEAD',
        message: `库数据已是 ${id}@${dataAhead.version} 格式，当前供给者 ${route.provider}@${route.version} 会误读：请重新启用覆盖者，或执行回退迁移（不自动执行）`,
        details: {
          capability: id,
          dataVersion: dataAhead.version,
          provider: route.provider,
          providerVersion: route.version,
          reason: 'DATA_VERSION_AHEAD',
          ...(dataAhead.journalPath ? { journalPath: dataAhead.journalPath } : {})
        }
      }
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
