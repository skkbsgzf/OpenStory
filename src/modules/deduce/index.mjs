import { deduceCapabilities } from './deduceCapability.mjs'
import { setFactHandles } from './engine/factPort.mjs'

export { deduceCapabilities }

export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  // OS-193 K2：内核之间只经能力句柄——装载期取 fact 句柄存进引擎的闭包，不再静态 import 实现。
  const store = context.resolve('fact.store', { min: 3 })
  const pack = context.resolve('fact.pack', { min: 1 })
  const domain = context.resolve('fact.domain', { min: 1 })
  setFactHandles({ store, pack, domain })
  return { capabilities: deduceCapabilities }
}
