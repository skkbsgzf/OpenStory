import { deduceCapabilities } from './deduceCapability.mjs'
import { setFactHandles } from './engine/factPort.mjs'
import { setTurnProseAgentRuntime } from './turnProse.mjs'

export { deduceCapabilities }

export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  // OS-193 K2：内核之间只经能力句柄——装载期取 fact 句柄存进引擎的闭包，不再静态 import 实现。
  const store = context.resolve('fact.store', { min: 3 })
  const pack = context.resolve('fact.pack', { min: 1 })
  const domain = context.resolve('fact.domain', { min: 1 })
  setFactHandles({ store, pack, domain })
  // OS-195b：对话通道经句柄取用后显式注入 turnProse，内核→内核不走 protocol 转供。
  const agentRuntime = context.resolve('agent.runtime', { min: 1 })
  setTurnProseAgentRuntime(agentRuntime)
  return { capabilities: deduceCapabilities }
}
