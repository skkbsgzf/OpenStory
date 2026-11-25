import { createCapabilityResolver } from './capabilityResolver.mjs'
import { capabilitySnapshotFor } from './modules.mjs'
import { MODULE_IMPLEMENTATIONS } from './capabilityImplementations.mjs'

const { media: mediaCapability } = MODULE_IMPLEMENTATIONS

export * from '../modules/media/comfyEngine.mjs'
export * from '../modules/media/generate.mjs'
export * from '../modules/media/describe.mjs'
export * from '../modules/media/probe.mjs'
export { mediaCapability }
export const mediaGenerateCapability = mediaCapability['media.generate']
export const mediaDescribeCapability = mediaCapability['media.describe']

export async function resolveMediaCapability(root, id, range = { min: 1 }) {
  const snapshot = await capabilitySnapshotFor(root)
  return createCapabilityResolver({ snapshot, implementations: MODULE_IMPLEMENTATIONS }).resolve(id, range)
}
