import { deduceCapabilities } from './deduceCapability.mjs'

export { deduceCapabilities }

export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  context.resolve('fact.store', { min: 3 })
  context.resolve('fact.pack', { min: 1 })
  return { capabilities: deduceCapabilities }
}
