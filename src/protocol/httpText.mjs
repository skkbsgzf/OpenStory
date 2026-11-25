/**
 * OS-193：纯文本归一 helper 转供叶——给归位到内核模块的业务件取 `text()`。
 * 只转不复制；实现真源 src/host/http.mjs。模块层不许直引 src/host/**（S2.1）。
 */
export { text } from '../host/http.mjs'
