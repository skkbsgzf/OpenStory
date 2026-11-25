/**
 * OS-193：纯契约helpers转供叶——给归位到内核模块的业务件取 `isPlainObject`。
 * 只转不复制；实现真源 src/api/contracts.mjs。模块层不许直引 src/api/**（S2.1）。
 */
export { isPlainObject } from '../api/contracts.mjs'
