/** OS-193 兼容转供叶：故事源书目盘点实现已归 fact 内核件（src/modules/fact/fact/books.mjs）。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const isFactBookFileName = (...a) => K.factBooks.isFactBookFileName(...a)
export const listFactBooks = (...a) => K.factBooks.listFactBooks(...a)
export const factOffsetOf = (...a) => K.factBooks.factOffsetOf(...a)
export const factLimitOf = (...a) => K.factBooks.factLimitOf(...a)
export const resolveFactBookId = (...a) => K.factBooks.resolveFactBookId(...a)
