import { createCapabilityResolver } from './capabilityResolver.mjs'
import { capabilitySnapshotFor } from './modules.mjs'
import { agentRuntimeCapability } from '../modules/agent-runtime/index.mjs'

export * from '../modules/agent-runtime/config.mjs'
export * from '../modules/agent-runtime/dsh-cli.mjs'
export * from '../modules/agent-runtime/credentials.mjs'
export { agentRuntimeCapability }
export const runtimeCapability = agentRuntimeCapability['agent.runtime']

export async function resolveAgentRuntimeCapability(root, id = 'agent.runtime', range = { min: 1 }) {
  const snapshot = await capabilitySnapshotFor(root)
  return createCapabilityResolver({ snapshot, implementations: { 'agent-runtime': agentRuntimeCapability } }).resolve(id, range)
}
