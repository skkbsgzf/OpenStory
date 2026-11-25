const CONTRIBUTION_KEYS = Object.freeze(['capabilities', 'handlers', 'pages', 'slots', 'settingsConsumers', 'hooks'])
/**
 * OS-195a：工作台给宿主（含 Agent 栏）的东西只能经 activate() 贡献钩子。
 * 钩子名登记在此，未登记的拒收——钩子不是随手挂的全局变量。
 * 每个钩子值是 { <模块局部名>: fn } 的对象，宿主按贡献表（同一按库快照换表机制）取用。
 */
export const CONTRIBUTION_HOOKS = Object.freeze(['beforeWrite', 'promptContext', 'referenceIndex', 'startup'])

export function isRegisteredHook(name) {
  return CONTRIBUTION_HOOKS.includes(name)
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateModuleContribution(manifest, contribution) {
  if (!plainObject(contribution)) return { ok: false, errors: ['activate 必须返回对象'] }
  const errors = []
  for (const key of Object.keys(contribution)) {
    if (!CONTRIBUTION_KEYS.includes(key)) errors.push(`activate 不得返回未声明字段 ${key}`)
  }
  for (const key of CONTRIBUTION_KEYS) {
    if (contribution[key] !== undefined && !plainObject(contribution[key])) errors.push(`${key} 必须是对象`)
  }
  for (const name of Object.keys(contribution.hooks ?? {})) {
    if (!isRegisteredHook(name)) errors.push(`钩子 ${name} 未在底座登记`)
    const slot = contribution.hooks[name]
    if (!plainObject(slot) || !Object.values(slot).every((fn) => typeof fn === 'function')) {
      errors.push(`钩子 ${name} 必须是 { 模块局部名: fn } 的函数表`)
    }
  }
  const declared = new Set((manifest.capabilities ?? []).map((item) => item.id))
  for (const id of Object.keys(contribution.capabilities ?? {})) {
    if (!declared.has(id)) errors.push(`能力 ${id} 未在 manifest 声明`)
    const implementation = contribution.capabilities[id]
    if (!plainObject(implementation) || !Object.values(implementation).some((value) => typeof value === 'function')) {
      errors.push(`能力 ${id} 必须至少暴露一个函数`)
    }
  }
  if (manifest.class === 'kernel' && Object.keys(contribution.capabilities ?? {}).length === 0) {
    errors.push('kernel activate 必须返回已声明能力')
  }
  // OS-196 G3：页面与 slot 贡献也必须来自 manifest 声明（端点已在下面双向校验）。
  const declaredPages = new Set((manifest.pages ?? []).map((item) => item.id))
  for (const id of Object.keys(contribution.pages ?? {})) {
    if (!declaredPages.has(id)) errors.push(`页面 ${id} 未在 manifest pages 声明`)
  }
  const declaredSlots = new Set((manifest.slots ?? []).map((item) => item.slot))
  for (const slot of Object.keys(contribution.slots ?? {})) {
    if (!declaredSlots.has(slot)) errors.push(`slot ${slot} 未在 manifest slots 声明`)
    const value = contribution.slots[slot]
    if (!plainObject(value) && typeof value !== 'function') errors.push(`slot ${slot} 必须是函数或 { 局部名: fn } 对象`)
  }
  // OS-194：handler 贡献与 manifest.endpoints 双向对齐——多一个越界键、少一个声明端点都拒收。
  const declaredEndpoints = new Set(manifest.endpoints ?? [])
  for (const id of Object.keys(contribution.handlers ?? {})) {
    if (!declaredEndpoints.has(id)) errors.push(`handler ${id} 未在 manifest endpoints 声明`)
  }
  for (const id of declaredEndpoints) {
    if (typeof contribution.handlers?.[id] !== 'function') errors.push(`声明端点 ${id} 没有 handler`)
  }
  return { ok: errors.length === 0, errors }
}

export function createModuleActivationContext(manifest, resolve, host = {}) {
  const resolved = []
  return {
    manifest,
    resolved,
    /** OS-194：宿主工具袋（契约词汇/HTTP 管线/授权）——模块 handler 从闭包取，不静态 import 宿主。 */
    host,
    resolve(id, range = { min: 1 }) {
      const result = resolve(id, range)
      if (!result?.ok) {
        const error = new Error(result?.message ?? `能力不可用：${id}`)
        error.code = result?.code ?? 'CAPABILITY_MISSING'
        error.details = result?.details
        throw error
      }
      resolved.push(Object.freeze({ id, range: Object.freeze({ ...range }), capability: result.capability }))
      return result.capability
    }
  }
}
