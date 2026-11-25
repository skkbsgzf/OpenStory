import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MODULE_MANIFESTS, MODULES_DIR } from '../protocol/modules.mjs'
import { createModuleActivationContext, validateModuleContribution } from '../protocol/moduleActivation.mjs'
import { capabilityResolver } from './capabilityBindings.mjs'

const entryCache = new Map()
const activationCache = new Map()

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

async function loadEntry(modulesDir, manifest) {
  const url = entryUrl(modulesDir, manifest)
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

export async function activateModules({
  snapshot, manifests = MODULE_MANIFESTS, modulesDir = MODULES_DIR, resolver = capabilityResolver(snapshot)
} = {}) {
  if (!snapshot?.id) throw new Error('激活模块需要能力快照')
  const cacheKey = JSON.stringify([snapshot.id, modulesDir, manifests.map((item) => [item.id, item.version, item.entry])])
  const cached = activationCache.get(cacheKey)
  if (cached) return cached
  const pending = (async () => {
    const resolverApi = resolver ?? capabilityResolver(snapshot)
    const activated = []
    for (const manifest of manifests) {
      if (!snapshot.enabled?.[manifest.id] || !manifest.entry) continue
      const module = await loadEntry(modulesDir, manifest)
      const context = createModuleActivationContext(manifest, resolverApi.resolve)
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
