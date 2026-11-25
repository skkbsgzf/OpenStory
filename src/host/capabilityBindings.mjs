import { createCapabilityResolver } from '../protocol/capabilityResolver.mjs'
import { MODULE_IMPLEMENTATIONS } from '../protocol/capabilityImplementations.mjs'
import { baseCapabilities } from './baseCapabilities.mjs'

const IMPLEMENTATIONS = Object.freeze({ base: baseCapabilities, ...MODULE_IMPLEMENTATIONS })

/** 内置实现表 ＋ 本机模块 activate() 贡献的实现（OS-196）。 */
export function capabilityResolver(snapshot, extraImplementations = {}) {
  const implementations = Object.keys(extraImplementations ?? {}).length
    ? Object.freeze({ ...IMPLEMENTATIONS, ...extraImplementations })
    : IMPLEMENTATIONS
  return createCapabilityResolver({ snapshot, implementations })
}

/**
 * OS-196：按库快照解析能力时经本机运行时拿「当前层」的 manifests 与本机实现。
 * 动态 import 只为了断开 moduleLoader → capabilityBindings → moduleRuntime 的静态环。
 */
export async function resolveCapability(root, id, range = { min: 1 }, env = process.env) {
  const { snapshotFor, localImplementations } = await import('./moduleRuntime.mjs')
  const [snapshot, implementations] = await Promise.all([snapshotFor(root, env), localImplementations(env)])
  return capabilityResolver(snapshot, implementations).resolve(id, range)
}

export async function resolveDeduceCapability(root) {
  return resolveCapability(root, 'deduce.engine', { min: 1 })
}

export async function resolveStorageCapability(root, id) {
  return resolveCapability(root, id, { min: 1 })
}

export async function resolveFactCapability(root, id, range) {
  return resolveCapability(root, id, range ?? { min: id === 'fact.store' ? 3 : 1 })
}

export async function resolveProseCapability(root) {
  return resolveCapability(root, 'prose.write', { min: 1 })
}

/** OS-193：原 protocol/{agentRuntime,media}.mjs 的薄 resolver 并入宿主能力绑定单一入口。 */
export async function resolveAgentRuntimeCapability(root, id = 'agent.runtime', range = { min: 1 }) {
  return resolveCapability(root, id, range)
}

export async function resolveMediaCapability(root, id, range = { min: 1 }) {
  return resolveCapability(root, id, range)
}
