/** 兼容转供叶：模型配置实现已归 agent.runtime 内核件（OS-193 起经唯一静态入口转供）。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

const of = () => K.agentRuntime
export const emptyConfigV2 = (...a) => of().emptyConfigV2(...a)
export const normalizeConfigV2 = (...a) => of().normalizeConfigV2(...a)
export const normalizeConfigBlock = (...a) => of().normalizeConfigBlock(...a)
export const validateConfigPatch = (...a) => of().validateConfigPatch(...a)
export const loadConfigV2 = (...a) => of().loadConfigV2(...a)
export const saveConfigV2 = (...a) => of().saveConfigV2(...a)
export const configPublicV2 = (...a) => of().configPublicV2(...a)
export const configPublicLegacy = (...a) => of().configPublicLegacy(...a)
export const configTextBlock = (...a) => of().configTextBlock(...a)
export const configAgentBlock = (...a) => of().configAgentBlock(...a)
export const chatCompletionsUrl = (...a) => of().chatCompletionsUrl(...a)
export const probeTextConfig = (...a) => of().probeTextConfig(...a)
export const maskApiKey = (...a) => of().maskApiKey(...a)
export const text = (...a) => of().text(...a)
