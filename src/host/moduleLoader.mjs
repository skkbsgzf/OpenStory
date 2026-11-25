import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MODULE_MANIFESTS, MODULES_DIR } from '../protocol/modules.mjs'
import { createModuleActivationContext, validateModuleContribution } from '../protocol/moduleActivation.mjs'
import { capabilityResolver } from './capabilityBindings.mjs'
import { baseCapabilities } from './baseCapabilities.mjs'
import { HOST_TOOLS } from './hostTools.mjs'

const entryCache = new Map()
const activationCache = new Map()

/**
 * OS-196 G3：本机模块只能从 context.base 拿五件底座能力的只读句柄。
 * loader 只给 snapshot/manifests/sources——activate 会装载任意代码，不交给本机模块。
 */
export const LOCAL_BASE_HANDLES = Object.freeze({
  process: baseCapabilities['base.process'],
  contract: baseCapabilities['base.contract'],
  write: baseCapabilities['base.write'],
  naming: baseCapabilities['base.naming'],
  loader: Object.freeze({
    snapshot: baseCapabilities['base.loader'].snapshot,
    manifests: baseCapabilities['base.loader'].manifests,
    sources: baseCapabilities['base.loader'].sources
  })
})

function entryUrl(modulesDir, manifest) {
  const entry = String(manifest.entry ?? '').replaceAll('\\', '/')
  if (!entry || entry.startsWith('/') || /^[a-zA-Z]:\//u.test(entry) || entry.split('/').includes('..')) {
    throw new Error(`模块 ${manifest.id} 的 entry 越出模块目录`)
  }
  const base = resolve(modulesDir, manifest.id)
  const target = resolve(base, entry)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`模块 ${manifest.id} 的 entry 越出模块目录`)
  return pathToFileURL(target).href
}

async function loadEntry(modulesDir, manifest, suffix = '') {
  const url = `${entryUrl(modulesDir, manifest)}${suffix}`
  let entry = entryCache.get(url)
  if (!entry) {
    entry = import(url).then((module) => {
      if (typeof module.activate !== 'function') throw new Error(`模块 ${manifest.id} 的 entry 必须导出 activate`)
      return module
    })
    entryCache.set(url, entry)
  }
  return entry
}

/** 激活上下文：内置与本机模块同形状；base 是底座五句柄的只读视图。 */
function contextFor(manifest, resolverApi, host, base) {
  const context = createModuleActivationContext(manifest, resolverApi.resolve, host)
  context.base = base ?? LOCAL_BASE_HANDLES
  return context
}

/**
 * 内置模块激活（OS-194 生产调用点）。缓存键纳入 G2 摘要：同版本改代码不再命中旧结果。
 */
export async function activateModules({
  snapshot, manifests = MODULE_MANIFESTS, modulesDir = MODULES_DIR,
  resolver = capabilityResolver(snapshot), host = HOST_TOOLS, sources = []
} = {}) {
  if (!snapshot?.id) throw new Error('激活模块需要能力快照')
  const fingerprint = (sources ?? []).map((item) => [item.id, item.manifestSha256, item.contentSha256])
  const cacheKey = JSON.stringify([snapshot.id, modulesDir, manifests.map((item) => [item.id, item.version, item.entry]), fingerprint])
  const cached = activationCache.get(cacheKey)
  if (cached) return cached
  const pending = (async () => {
    const resolverApi = resolver ?? capabilityResolver(snapshot)
    const activated = []
    for (const manifest of manifests) {
      if (!snapshot.enabled?.[manifest.id] || !manifest.entry) continue
      const module = await loadEntry(modulesDir, manifest)
      const context = contextFor(manifest, resolverApi, host)
      const contribution = await module.activate(context)
      const checked = validateModuleContribution(manifest, contribution)
      if (!checked.ok) throw new Error(`模块 ${manifest.id} 激活贡献非法：${checked.errors.join('；')}`)
      activated.push(Object.freeze({ id: manifest.id, contribution, resolved: context.resolved }))
    }
    return Object.freeze({ snapshot: snapshot.id, activated })
  })()
  activationCache.set(cacheKey, pending)
  try {
    return await pending
  } catch (error) {
    activationCache.delete(cacheKey)
    throw error
  }
}

/**
 * OS-196：激活一个来自本机模块根的模块。
 * 入口 URL 带内容摘要查询串——同一路径改代码不升版本也会重新 import，旧激活结果绝不复用。
 */
export async function activateLocalModule({
  root, manifest, snapshot, resolver, host = HOST_TOOLS, contentSha256 = ''
} = {}) {
  if (!root || !manifest?.id || !manifest.entry) throw new Error('本机模块激活缺 root/manifest/entry')
  const suffix = contentSha256 ? `?v=${encodeURIComponent(contentSha256)}` : ''
  const module = await loadEntry(root, manifest, suffix)
  const context = contextFor(manifest, resolver, host, LOCAL_BASE_HANDLES)
  const contribution = await module.activate(context)
  const checked = validateModuleContribution(manifest, contribution)
  if (!checked.ok) {
    const error = new Error(`模块 ${manifest.id} 激活贡献非法：${checked.errors.join('；')}`)
    error.code = 'CONTRIBUTION_REJECTED'
    error.details = { module: manifest.id, errors: checked.errors }
    throw error
  }
  return Object.freeze({
    id: manifest.id,
    snapshot: snapshot?.id ?? '',
    contribution,
    resolved: context.resolved
  })
}
