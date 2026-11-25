/**
 * 浏览器兼容转供叶（C5b）。
 *
 * 纯分析引擎只有一个真源：src/modules/text/analysis.mjs。
 * public/ 静态根不覆盖 src/，故 daemon 只精确托管 /src/modules/text/analysis.mjs；
 * 本文件用同源绝对 URL 转供，Node 消费者请走 src/protocol/text.mjs。
 */
export { analyzeChapter, splitSentences } from '/src/modules/text/analysis.mjs'
