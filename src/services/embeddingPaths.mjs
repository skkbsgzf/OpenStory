/** OS-193 兼容转供叶：embedding 路径解析实现已归 agent-runtime 内核件。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const resolveRepoRoot = (...a) => K.agentRuntime.resolveRepoRoot(...a)
export const resolveEmbeddingPaths = (...a) => K.agentRuntime.resolveEmbeddingPaths(...a)
