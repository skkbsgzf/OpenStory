import { createCapabilityResolver } from '../protocol/capabilityResolver.mjs'
import { MODULE_IMPLEMENTATIONS } from '../protocol/capabilityImplementations.mjs'
import { baseCapabilities } from './baseCapabilities.mjs'

const IMPLEMENTATIONS = Object.freeze({ base: baseCapabilities, ...MODULE_IMPLEMENTATIONS })

/** 内置实现表 ＋ 本机模块 activate() 贡献的实现（OS-196）。 */
export function capabilityResolver(snapshot, extraImplementations = {}, dataVersions = []) {
  const implementations = Object.keys(extraImplementations ?? {}).length
    ? Object.freeze({ ...IMPLEMENTATIONS, ...extraImplementations })
    : IMPLEMENTATIONS
  return createCapabilityResolver({ snapshot, implementations, dataVersions })
}

/**
 * OS-196：按库快照解析能力时经本机运行时拿「当前层」的 manifests 与本机实现。
 * OS-197a：同时取该库已迁数据档位交给 resolver——旧供给者在解析层就拒发句柄，
 * 宿主自有端点、钩子与 MCP 直连都走这道判定，不只 daemon 的端点闸。
 * 动态 import 只为了断开 moduleLoader → capabilityBindings → moduleRuntime 的静态环。
 */
export async function resolveCapability(root, id, range = { min: 1 }, env = process.env) {
  const { snapshotFor, localImplementations, migrationStateFor } = await import('./moduleRuntime.mjs')
  const [snapshot, implementations, migration] = await Promise.all([
    snapshotFor(root, env),
    localImplementations(env),
    root ? migrationStateFor(root, env) : Promise.resolve(null)
  ])
  return capabilityResolver(snapshot, implementations, root ? (migration?.dataVersions ?? []) : []).resolve(id, range)
}

export async function resolveDeduceCapability(root, env = process.env) {
  return resolveCapability(root, 'deduce.engine', { min: 1 }, env)
}

export async function resolveStorageCapability(root, id, env = process.env) {
  return resolveCapability(root, id, { min: 1 }, env)
}

export async function resolveFactCapability(root, id, range, env = process.env) {
  return resolveCapability(root, id, range ?? { min: id === 'fact.store' ? 3 : 1 }, env)
}

export async function resolveProseCapability(root, env = process.env) {
  return resolveCapability(root, 'prose.write', { min: 1 }, env)
}

/** OS-193：原 protocol/{agentRuntime,media}.mjs 的薄 resolver 并入宿主能力绑定单一入口。 */
export async function resolveAgentRuntimeCapability(root, id = 'agent.runtime', range = { min: 1 }, env = process.env) {
  return resolveCapability(root, id, range, env)
}

export async function resolveMediaCapability(root, id, range = { min: 1 }, env = process.env) {
  return resolveCapability(root, id, range, env)
}
