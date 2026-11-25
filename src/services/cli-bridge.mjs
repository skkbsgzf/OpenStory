/** OS-193 兼容转供叶：CLI 嫁接桥实现已归 agent-runtime 内核件。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const composeCliPrompt = (...a) => K.agentRuntime.composeCliPrompt(...a)
export const buildCliArgs = (...a) => K.agentRuntime.buildCliArgs(...a)
export const runCliChat = (...a) => K.agentRuntime.runCliChat(...a)
