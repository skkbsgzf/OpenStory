/** OS-193 兼容转供叶：聊天上游解析实现已归 agent-runtime 内核件。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const resolveChatUpstream = (...a) => K.agentRuntime.resolveChatUpstream(...a)
export const chatCompleteViaUpstream = (...a) => K.agentRuntime.chatCompleteViaUpstream(...a)
export const resolveUpstreamSafe = (...a) => K.agentRuntime.resolveUpstreamSafe(...a)
