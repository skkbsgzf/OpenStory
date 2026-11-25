import { createCapabilityResolver } from '../protocol/capabilityResolver.mjs'
import { capabilitySnapshotFor } from '../protocol/modules.mjs'
import { MODULE_IMPLEMENTATIONS } from '../protocol/capabilityImplementations.mjs'
import { baseCapabilities } from './baseCapabilities.mjs'

const IMPLEMENTATIONS = Object.freeze({ base: baseCapabilities, ...MODULE_IMPLEMENTATIONS })

export function capabilityResolver(snapshot) {
  return createCapabilityResolver({ snapshot, implementations: IMPLEMENTATIONS })
}

export async function resolveCapability(root, id, range = { min: 1 }) {
  return capabilityResolver(await capabilitySnapshotFor(root)).resolve(id, range)
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
