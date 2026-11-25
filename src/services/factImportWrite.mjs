/** OS-193 兼容转供叶：fact 条目唯一写通道实现已归 fact 内核件（src/modules/fact/fact/importWrite.mjs）。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const writeFactEntries = (...a) => K.factWrite.writeFactEntries(...a)
