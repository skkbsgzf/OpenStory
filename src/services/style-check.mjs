/** OS-193 兼容转供叶：文风指纹门禁实现已归 text 内核件（src/modules/text/lint.mjs）。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const measure = (...a) => K.textAnalyze.measure(...a)
export const listFingerprintPacks = (...a) => K.textAnalyze.listFingerprintPacks(...a)
export const fingerprintHint = (...a) => K.textAnalyze.fingerprintHint(...a)
export const runStyleCheck = (...a) => K.textAnalyze.runStyleCheck(...a)
